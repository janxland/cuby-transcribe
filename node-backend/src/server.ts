import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createTask, getTask } from "./store.js";
import { runTask } from "./agent.js";

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });

app.get("/health", async () => ({ status: "ok", service: "node-backend" }));

app.post("/api/transcribe", async (req, reply) => {
  const parts = req.parts();
  let savedPath: string | null = null;
  let originalName = "audio";
  let options: any = {};

  for await (const part of parts) {
    if (part.type === "file") {
      originalName = part.filename;
      const ext = path.extname(originalName) || ".wav";
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      savedPath = path.join(UPLOAD_DIR, `${id}${ext}`);
      await pipeline(part.file, fs.createWriteStream(savedPath));
    } else if (part.fieldname === "options") {
      try {
        options = JSON.parse(part.value as string);
      } catch {
        options = {};
      }
    }
  }

  if (!savedPath) {
    return reply.code(400).send({ error: "missing file" });
  }

  const task = createTask(savedPath, options);
  // 异步触发，不阻塞响应
  runTask(task).catch((e) => app.log.error(e));

  return { taskId: task.taskId, status: task.status };
});

app.get("/api/transcribe/:taskId", async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const task = getTask(taskId);
  if (!task) return reply.code(404).send({ error: "not found" });
  return {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    message: task.message,
    result: task.result,
    metadata: task.metadata,
    error: task.error,
  };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`Backend listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
