import { create } from "zustand";
import type { CubyScore, Metadata, StemInfo, TaskState, UploadOptions } from "./types";
import { getTask, retranscribeStem, uploadAudio } from "./api";

interface Store {
  file: File | null;
  audioUrl: string | null;
  options: UploadOptions;

  task: TaskState | null;
  parentTaskId: string | null;   // 首个任务（含 stems）
  score: CubyScore | null;
  meta: Metadata | null;
  stems: StemInfo[];

  isPlaying: boolean;
  currentTime: number;

  setFile: (f: File | null) => void;
  setOptions: (o: Partial<UploadOptions>) => void;
  startUpload: () => Promise<void>;
  retranscribeWith: (stem: string) => Promise<void>;
  reset: () => void;
  setPlayback: (p: { isPlaying?: boolean; currentTime?: number }) => void;
}

const DEFAULT_OPTIONS: UploadOptions = {
  transposeToC: true,
  simplifyMelody: true,
  quantizeGrid: 16,
  separationMode: "none",
};

export const useStore = create<Store>((set, get) => ({
  file: null,
  audioUrl: null,
  options: DEFAULT_OPTIONS,
  task: null,
  parentTaskId: null,
  score: null,
  meta: null,
  stems: [],
  isPlaying: false,
  currentTime: 0,

  setFile: (f) => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      file: f,
      audioUrl: f ? URL.createObjectURL(f) : null,
      task: null, parentTaskId: null,
      score: null, meta: null, stems: [],
      isPlaying: false, currentTime: 0,
    });
  },

  setOptions: (o) => set({ options: { ...get().options, ...o } }),
  setPlayback: (p) => set((s) => ({ ...s, ...p })),

  reset: () => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      file: null, audioUrl: null,
      task: null, parentTaskId: null,
      score: null, meta: null, stems: [],
      isPlaying: false, currentTime: 0,
    });
  },

  startUpload: async () => {
    const { file, options } = get();
    if (!file) return;
    set({
      task: { taskId: "", status: "queued", progress: 0, message: "uploading..." },
      stems: [], score: null, meta: null,
    });

    let taskId: string;
    try {
      const r = await uploadAudio(file, options);
      taskId = r.taskId;
      set({ task: { taskId, status: "queued", progress: 5, message: "queued" }, parentTaskId: taskId });
    } catch (e: any) {
      set({ task: { taskId: "", status: "failed", progress: 0, message: "upload failed", error: e.message } });
      return;
    }

    await pollUntilDone(taskId, (s) => {
      set({ task: s });
      if (s.status === "completed") {
        set({
          score: s.result ?? null,
          meta: s.metadata ?? null,
          stems: s.stems ?? [],
        });
      }
    });
  },

  retranscribeWith: async (stem: string) => {
    const parent = get().parentTaskId;
    if (!parent) return;
    set({
      task: { taskId: "", status: "processing", progress: 10, message: `retranscribing ${stem}…` },
      score: null, meta: null,
    });
    try {
      const r = await retranscribeStem(parent, stem);
      await pollUntilDone(r.taskId, (s) => {
        set({ task: s });
        if (s.status === "completed") {
          set({ score: s.result ?? null, meta: s.metadata ?? null });
        }
      });
    } catch (e: any) {
      set({ task: { taskId: "", status: "failed", progress: 0, message: "failed", error: e.message } });
    }
  },
}));

async function pollUntilDone(taskId: string, onUpdate: (s: TaskState) => void) {
  while (true) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const s = await getTask(taskId);
      onUpdate(s);
      if (s.status === "completed" || s.status === "failed") return;
    } catch (e: any) {
      onUpdate({ taskId, status: "failed", progress: 0, message: "poll failed", error: e.message });
      return;
    }
  }
}
