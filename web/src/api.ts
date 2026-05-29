import type { TaskState, UploadOptions } from "./types";

const API = ""; // 走 Vite 代理 /api

export async function uploadAudio(file: File, options: UploadOptions): Promise<{ taskId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("options", JSON.stringify(options));
  const r = await fetch(`${API}/api/transcribe`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return r.json();
}

export async function getTask(taskId: string): Promise<TaskState> {
  const r = await fetch(`${API}/api/transcribe/${taskId}`);
  if (!r.ok) throw new Error(`status failed: ${r.status}`);
  return r.json();
}
