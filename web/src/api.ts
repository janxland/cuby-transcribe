/**
 * 业务 API 端点：仅声明请求/响应形状，HTTP 细节集中在 lib/http.ts。
 */
import type { CubyScore, ScoreCleanupOptions, ScoreCleanupStats, TaskState, UploadOptions } from "@/types";
import { request } from "@/lib/http";

export async function uploadAudio(
  file: File,
  options: UploadOptions,
  signal?: AbortSignal,
): Promise<{ taskId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("options", JSON.stringify(options));
  // 上传不设默认超时（大文件 + 服务器排队可能较长）
  return request("/api/transcribe", { method: "POST", body: fd, signal, timeoutMs: 0 });
}

export function getTask(taskId: string, signal?: AbortSignal): Promise<TaskState> {
  return request(`/api/transcribe/${taskId}`, { signal });
}

export function retranscribeStem(
  taskId: string,
  stem: string,
  signal?: AbortSignal,
): Promise<{ taskId: string }> {
  return request(`/api/transcribe/${taskId}/retranscribe`, {
    method: "POST",
    body: { stem },
    signal,
  });
}

export function cancelTranscribeTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<{ taskId: string; status: string; message: string }> {
  return request(`/api/transcribe/${taskId}/cancel`, {
    method: "POST",
    signal,
  });
}

export function cleanupScoreWithAi(
  score: CubyScore,
  options: ScoreCleanupOptions,
  signal?: AbortSignal,
): Promise<{ success: boolean; cubyScore: CubyScore; stats: ScoreCleanupStats }> {
  return request("/api/score/cleanup", {
    method: "POST",
    body: { score, options },
    signal,
    timeoutMs: 0,
  });
}
