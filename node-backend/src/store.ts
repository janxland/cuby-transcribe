export type TaskStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface TaskOptions {
  target?: "vocal" | "instrument" | "auto";
  transposeToC?: boolean;
  quantizeGrid?: 8 | 16;
  simplifyMelody?: boolean;
}

export interface Task {
  taskId: string;
  status: TaskStatus;
  progress: number;
  message: string;
  audioPath: string;
  options: TaskOptions;
  createdAt: number;
  result?: any;
  metadata?: any;
  error?: string;
}

const tasks = new Map<string, Task>();

export function createTask(audioPath: string, options: TaskOptions): Task {
  const taskId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const task: Task = {
    taskId,
    status: "queued",
    progress: 0,
    message: "queued",
    audioPath,
    options,
    createdAt: Date.now(),
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
