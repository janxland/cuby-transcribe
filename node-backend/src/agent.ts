import axios from "axios";
import { updateTask, type Task, type StemInfo } from "./store.js";

const AGENT_URL = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
const taskControllers = new Map<string, AbortController>();

export function cancelRunningTask(taskId: string): boolean {
  const ctrl = taskControllers.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  taskControllers.delete(taskId);
  return true;
}

export async function runTask(task: Task) {
  const ctrl = new AbortController();
  taskControllers.set(task.taskId, ctrl);
  try {
    const sep = task.options.separationMode ?? "none";
    updateTask(task.taskId, {
      status: "processing",
      progress: sep === "none" ? 30 : 10,
      message: sep === "none" ? "transcribing" : "separating + transcribing",
    });
    const resp = await axios.post(
      `${AGENT_URL}/internal/process`,
      {
        audioPath: task.audioPath,
        options: task.options,
        taskId: task.taskId,        // 让 Python 用同一个 id，方便 stems URL 一致
      },
      { timeout: 30 * 60 * 1000, signal: ctrl.signal }
    );
    const { cubyScore, metadata, stems = [], taskId: agentId } = resp.data;

    // 把 Python 内部 URL 改写为对外 /api/stems/... URL
    const rewritten: StemInfo[] = stems.map((s: any) => ({
      name: s.name,
      duration: s.duration,
      url: `/api/stems/${agentId}/${s.name}.wav`,
    }));

    updateTask(task.taskId, {
      status: "completed",
      progress: 100,
      message: "done",
      result: cubyScore,
      metadata,
      stems: rewritten,
      agentTaskId: agentId,
    });
  } catch (err: any) {
    if (err?.code === "ERR_CANCELED") {
      updateTask(task.taskId, {
        status: "canceled",
        progress: 0,
        message: "canceled",
        error: undefined,
      });
      return;
    }
    const detail = err?.response?.data?.detail || err?.message || String(err);
    updateTask(task.taskId, {
      status: "failed",
      progress: 0,
      message: "failed",
      error: detail,
    });
  } finally {
    taskControllers.delete(task.taskId);
  }
}

export const PYTHON_AGENT_URL = AGENT_URL;
