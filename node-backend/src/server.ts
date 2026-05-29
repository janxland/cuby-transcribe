import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createTask, getTask } from "./store.js";
import { runTask, PYTHON_AGENT_URL } from "./agent.js";

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
    stems: task.stems ?? [],
    error: task.error,
  };
});

// 用已分离的某条 stem 重新转录（不重做分离）
app.post("/api/transcribe/:taskId/retranscribe", async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const task = getTask(taskId);
  if (!task || !task.agentTaskId) {
    return reply.code(404).send({ error: "task not found or no stems" });
  }
  const body = (req.body ?? {}) as { stem?: string };
  const stem = body.stem ?? "vocals";

  // 直接拿 stem 文件的本地路径（在 Python 容器内是 /tmp/cuby-stems/<agentId>/<stem>.wav；
  // 在 docker-compose 中我们可以共享卷；本地开发时直接走 URL 拉取）
  // 这里简化：复制 stem 内容到本地，再发起新任务。
  const url = `${PYTHON_AGENT_URL}/internal/stems/${task.agentTaskId}/${stem}.wav`;
  const r = await fetch(url);
  if (!r.ok || !r.body) return reply.code(404).send({ error: "stem fetch failed" });
  const saved = path.join(UPLOAD_DIR, `${task.taskId}_${stem}.wav`);
  const ws = fs.createWriteStream(saved);
  // @ts-ignore
  await pipeline(r.body as any, ws);

  // 直接喂这条 stem 的 wav，告知 Python 这次扒的就是这条 stem
  // —— 不再二次分离，但保留 stem 身份用于 metadata.transcribedStem
  const newTask = createTask(saved, {
    ...task.options,
    separationMode: "none",
    transcribeStem: stem,
  });
  runTask(newTask).catch((e) => app.log.error(e));
  return { taskId: newTask.taskId, status: newTask.status };
});

// 代理 stem 文件
app.get("/api/stems/:agentId/:name", async (req, reply) => {
  const { agentId, name } = req.params as { agentId: string; name: string };
  if (agentId.includes("..") || name.includes("..") || agentId.includes("/")) {
    return reply.code(400).send({ error: "invalid path" });
  }
  const url = `${PYTHON_AGENT_URL}/internal/stems/${agentId}/${name}`;
  const r = await fetch(url);
  if (!r.ok || !r.body) return reply.code(r.status).send();
  reply.header("content-type", r.headers.get("content-type") || "audio/wav");
  return reply.send(r.body);
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`Backend listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
