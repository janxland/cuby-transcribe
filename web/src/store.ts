import { create } from "zustand";
import type { CubyScore, Metadata, StemInfo, TaskState, UploadOptions } from "./types";
import { getTask, retranscribeStem, uploadAudio } from "./api";

interface ScoreEntry { score: CubyScore; meta: Metadata }

interface Store {
  file: File | null;
  audioUrl: string | null;
  options: UploadOptions;

  task: TaskState | null;
  parentTaskId: string | null;     // 含 stems 的首个任务，retranscribe 用

  /** 已生成的扒谱集合，key = stem name（vocals / piano / drums ...） */
  scores: Record<string, ScoreEntry>;
  /**
   * 当前「正在使用」的扒谱 stem 列表（有序，front=主显）。
   *   - Sky15 会把列表里所有 score 同时按播放头自动弹奏；
   *   - PianoRoll / JSON 等单视图组件读取 `score`/`meta`（= activeStems[0] 对应的条目）。
   */
  activeStems: string[];
  /** activeStems[0] 对应的 score / meta —— 派生字段，便于单视图消费者读取 */
  score: CubyScore | null;
  meta: Metadata | null;

  stems: StemInfo[];

  /** 原音预听条上报，PianoRoll 用作 playhead */
  currentTime: number;

  setFile: (f: File | null) => void;
  setOptions: (o: Partial<UploadOptions>) => void;
  setCurrentTime: (t: number) => void;
  /** 点击一条 stem：在 activeStems 里加入或移出；新加入的置于 front 成为主显 */
  toggleActiveStem: (stem: string) => void;
  startUpload: () => Promise<void>;
  retranscribeWith: (stem: string) => Promise<void>;
  reset: () => void;
}

const DEFAULT_OPTIONS: UploadOptions = {
  transposeToC: true,
  simplifyMelody: true,
  quantizeGrid: 16,
  separationMode: "none",
  stems: [],
};

// 切换/清除文件时的统一重置
const blank = () => ({
  task: null, parentTaskId: null,
  scores: {} as Record<string, ScoreEntry>,
  activeStems: [] as string[],
  score: null as CubyScore | null,
  meta: null as Metadata | null,
  stems: [] as StemInfo[],
  currentTime: 0,
});

/**
 * 把新生成的 score 合并进 scores 集合：
 *  - 写入 / 覆盖 `scores[stem]`；
 *  - 把该 stem 置于 activeStems 首位（若已存在则提前），使其成为主显并自动加入演奏列表。
 */
function mergeScore(
  prevScores: Record<string, ScoreEntry>,
  prevActive: string[],
  score: CubyScore,
  meta: Metadata,
) {
  const stem = meta.transcribedStem || "unknown";
  const scores = { ...prevScores, [stem]: { score, meta } };
  const activeStems = [stem, ...prevActive.filter((s) => s !== stem)];
  return { scores, activeStems, score, meta };
}

export const useStore = create<Store>((set, get) => ({
  file: null,
  audioUrl: null,
  options: DEFAULT_OPTIONS,
  ...blank(),

  setFile: (f) => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ file: f, audioUrl: f ? URL.createObjectURL(f) : null, ...blank() });
  },

  setOptions: (o) => set({ options: { ...get().options, ...o } }),
  setCurrentTime: (t) => set({ currentTime: t }),

  toggleActiveStem: (stem) => {
    const { scores, activeStems } = get();
    if (!scores[stem]) return;
    const has = activeStems.includes(stem);
    const next = has
      ? activeStems.filter((s) => s !== stem)
      : [stem, ...activeStems];
    const primary = next[0] ?? null;
    set({
      activeStems: next,
      score: primary ? scores[primary].score : null,
      meta: primary ? scores[primary].meta : null,
    });
  },

  reset: () => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ file: null, audioUrl: null, ...blank() });
  },

  startUpload: async () => {
    const { file, options } = get();
    if (!file) return;
    set({
      task: { taskId: "", status: "queued", progress: 0, message: "uploading..." },
      stems: [],
      scores: {}, activeStems: [], score: null, meta: null,
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
        const patch: Partial<Store> = { stems: s.stems ?? get().stems };
        if (s.result && s.metadata) {
          Object.assign(patch, mergeScore(get().scores, get().activeStems, s.result, s.metadata));
        }
        set(patch as any);
      }
    });
  },

  retranscribeWith: async (stem: string) => {
    const parent = get().parentTaskId;
    if (!parent) return;
    // 关键：不再清空当前 score / meta；让用户在等待期间仍能查看 / 切换已有扒谱
    set({ task: { taskId: "", status: "processing", progress: 10, message: `retranscribing ${stem}…` } });
    try {
      const r = await retranscribeStem(parent, stem);
      await pollUntilDone(r.taskId, (s) => {
        set({ task: s });
        if (s.status === "completed" && s.result && s.metadata) {
          set(mergeScore(get().scores, get().activeStems, s.result, s.metadata) as any);
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
