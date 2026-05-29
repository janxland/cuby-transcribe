import { create } from "zustand";
import type { CubyScore, Metadata, TaskState, UploadOptions } from "./types";
import { getTask, uploadAudio } from "./api";

interface Store {
  file: File | null;
  audioUrl: string | null;
  options: UploadOptions;

  task: TaskState | null;
  score: CubyScore | null;
  meta: Metadata | null;

  // playback
  isPlaying: boolean;
  currentTime: number;

  setFile: (f: File | null) => void;
  setOptions: (o: Partial<UploadOptions>) => void;
  startUpload: () => Promise<void>;
  reset: () => void;
  setPlayback: (p: { isPlaying?: boolean; currentTime?: number }) => void;
}

export const useStore = create<Store>((set, get) => ({
  file: null,
  audioUrl: null,
  options: { transposeToC: true, simplifyMelody: true, quantizeGrid: 16 },

  task: null,
  score: null,
  meta: null,

  isPlaying: false,
  currentTime: 0,

  setFile: (f) => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      file: f,
      audioUrl: f ? URL.createObjectURL(f) : null,
      task: null,
      score: null,
      meta: null,
      isPlaying: false,
      currentTime: 0,
    });
  },

  setOptions: (o) => set({ options: { ...get().options, ...o } }),

  setPlayback: (p) => set((s) => ({ ...s, ...p })),

  reset: () => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      file: null, audioUrl: null,
      task: null, score: null, meta: null,
      isPlaying: false, currentTime: 0,
    });
  },

  startUpload: async () => {
    const { file, options } = get();
    if (!file) return;
    set({ task: { taskId: "", status: "queued", progress: 0, message: "uploading..." } });

    let taskId: string;
    try {
      const r = await uploadAudio(file, options);
      taskId = r.taskId;
      set({ task: { taskId, status: "queued", progress: 5, message: "queued" } });
    } catch (e: any) {
      set({ task: { taskId: "", status: "failed", progress: 0, message: "upload failed", error: e.message } });
      return;
    }

    // 轮询
    while (true) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const s = await getTask(taskId);
        set({ task: s });
        if (s.status === "completed") {
          set({ score: s.result ?? null, meta: s.metadata ?? null });
          return;
        }
        if (s.status === "failed") return;
      } catch (e: any) {
        set({ task: { taskId, status: "failed", progress: 0, message: "poll failed", error: e.message } });
        return;
      }
    }
  },
}));
