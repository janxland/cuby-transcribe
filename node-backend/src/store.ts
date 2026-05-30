export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export interface TaskOptions {
  transposeToC?: boolean;
  quantizeGrid?: 8 | 16;
  simplifyMelody?: boolean;
  separationMode?: "none" | "vocals" | "4stems";
  transcribeStem?:
    | "original" | "vocals" | "no_vocals" | "drums" | "bass" | "other";
  /** v2: polyphonic 保留和弦 / monophonic 单音 */
  arrangementMode?: "polyphonic" | "monophonic";
  /** 同帧最大并发音数（polyphonic 模式生效，建议 2-4） */
  maxSimultaneous?: number;
  /** 是否做和弦识别（polyphonic 模式必备；monophonic 仅作元数据展示） */
  detectChords?: boolean;
  /** 旧字段，兼容；等价于 arrangementMode='monophonic' */
  forceMonophonic?: boolean;
  melodyMode?: "auto" | "vocal";
  optimizePlayKey?: boolean;
}

export interface StemInfo {
  name: string;
  url: string;       // 对外 URL: /api/stems/:taskId/:name.wav
  duration: number;
}

export interface Task {
  taskId: string;
  status: TaskStatus;
  progress: number;
  message: string;
  audioPath: string;
  options: TaskOptions;
  result?: any;
  metadata?: any;
  stems?: StemInfo[];
  agentTaskId?: string;  // Python 端的 taskId (用于 stems URL)
  error?: string;
}

const tasks = new Map<string, Task>();

export function createTask(audioPath: string, options: TaskOptions): Task {
  const taskId =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const task: Task = {
    taskId,
    status: "queued",
    progress: 0,
    message: "queued",
    audioPath,
    options,
  };
  tasks.set(taskId, task);
  return task;
}

export function getTask(taskId: string): Task | undefined {
  return tasks.get(taskId);
}

export function updateTask(taskId: string, patch: Partial<Task>) {
  const t = tasks.get(taskId);
  if (t) Object.assign(t, patch);
}
