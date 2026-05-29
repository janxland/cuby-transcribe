import axios from "axios";
import { updateTask, type Task } from "./store.js";

const AGENT_URL = process.env.PYTHON_AGENT_URL || "http://localhost:8000";

export async function runTask(task: Task) {
  try {
    updateTask(task.taskId, { status: "processing", progress: 10, message: "transcribing" });
    const resp = await axios.post(
      `${AGENT_URL}/internal/process`,
      { audioPath: task.audioPath, options: task.options },
      { timeout: 10 * 60 * 1000 }
    );
    const { cubyScore, metadata } = resp.data;
    updateTask(task.taskId, {
      status: "completed",
      progress: 100,
      message: "done",
      result: cubyScore,
      metadata,
    });
  } catch (err: any) {
    const detail = err?.response?.data?.detail || err?.message || String(err);
    updateTask(task.taskId, {
      status: "failed",
      progress: 0,
      message: "failed",
      error: detail,
    });
  }
}
