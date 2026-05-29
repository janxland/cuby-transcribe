import type { TaskState, UploadOptions } from "./types";

const API = "";

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

export async function retranscribeStem(taskId: string, stem: string): Promise<{ taskId: string }> {
  const r = await fetch(`${API}/api/transcribe/${taskId}/retranscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stem }),
  });
  if (!r.ok) throw new Error(`retranscribe failed: ${r.status}`);
  return r.json();
}
