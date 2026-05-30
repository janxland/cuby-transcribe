/**
 * 轻量 HTTP 客户端 + 统一错误模型。
 *  - 集中 baseURL / 超时 / JSON 解析 / 错误标准化；
 *  - 业务层只关心 endpoint 与 payload；
 *  - 通过 AbortSignal 支持取消（轮询、组件卸载等场景）。
 */

const BASE_URL: string = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "";
const DEFAULT_TIMEOUT_MS = 30_000;

export type AppErrorCode =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "parse"
  | "unknown";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status?: number;
  readonly cause?: unknown;
  readonly retriable: boolean;

  constructor(opts: {
    code: AppErrorCode;
    message: string;
    status?: number;
    cause?: unknown;
    retriable?: boolean;
  }) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.status = opts.status;
    this.cause = opts.cause;
    this.retriable = opts.retriable ?? (opts.code === "network" || opts.code === "timeout");
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof DOMException && e.name === "AbortError") {
    return new AppError({ code: "aborted", message: "request aborted" });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new AppError({ code: "unknown", message: msg, cause: e });
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: BodyInit | object;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 单位 ms；不指定走默认 30s；传 0 表示不超时（如长轮询不希望被中断） */
  timeoutMs?: number;
}

/** 统一 fetch 包装。返回 JSON 解析后的对象（`T`）。 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  // 拼装 headers / body —— 普通对象自动 JSON 化；FormData / Blob 等原样
  const isJsonObject = body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob);
  const finalHeaders: Record<string, string> = { ...headers };
  if (isJsonObject && !finalHeaders["content-type"]) finalHeaders["content-type"] = "application/json";

  // 合并外部 signal 与超时 signal
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = timeoutMs > 0 ? window.setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs) : 0;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: isJsonObject ? JSON.stringify(body) : (body as BodyInit | undefined),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new AppError({ code: "timeout", message: `request timed out: ${path}`, cause: e });
    }
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AppError({ code: "aborted", message: "request aborted", cause: e });
    }
    throw new AppError({ code: "network", message: e instanceof Error ? e.message : "network failure", cause: e });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError({
      code: "http",
      status: res.status,
      message: `${method} ${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      retriable: res.status >= 500,
    });
  }

  // 204 / 空 body 容错
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !ct.includes("application/json")) {
    return undefined as unknown as T;
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new AppError({ code: "parse", message: "invalid JSON response", cause: e });
  }
}
