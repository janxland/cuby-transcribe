/**
 * 全局状态：
 *  - 单一事实源 = `scores` 集合 + `activeStems` 顺序；
 *  - 派生数据（主显 score / meta）通过 selectors.ts 暴露的 hooks 消费，store 自身不再冗余持有；
 *  - 异步流程（上传 / 轮询 / 重扒）走带版本守卫 + AbortController 的 runJob，
 *    切文件 / 取消时旧请求不会回写新状态。
 */
import { create } from "zustand";
import type { CubyScore, Metadata, StemInfo, TaskState, UploadOptions } from "@/types";
import { getTask, retranscribeStem, uploadAudio } from "@/api";
import { toAppError } from "@/lib/http";

export interface ScoreEntry { score: CubyScore; meta: Metadata }

interface Store {
  file: File | null;
  audioUrl: string | null;
  options: UploadOptions;

  task: TaskState | null;
  /** 含 stems 的首个任务，retranscribe 用 */
  parentTaskId: string | null;

  /** 已生成的扒谱集合，key = stem name（vocals / piano / drums ...） */
  scores: Record<string, ScoreEntry>;
  /**
   * 当前「正在使用」的扒谱 stem 列表（有序，front=主显）。
   *   - Sky15 会把列表里所有 score 同时按播放头自动弹奏；
   *   - 主显 score / meta 通过 selectors.ts 派生，store 不再冗余存储。
   */
  activeStems: string[];

  stems: StemInfo[];

  /** 原音预听条上报，PianoRoll 用作 playhead */
  currentTime: number;

  setFile: (f: File | null) => void;
  setOptions: (o: Partial<UploadOptions>) => void;
  setCurrentTime: (t: number) => void;
  /** 点击一条 stem：在 activeStems 里加入或移出；新加入的置于 front 成为主显 */
  toggleActiveStem: (stem: string) => void;
  /** 编辑器写回：用新的 notes 列表替换某 stem 的 score.tracks[0].notes（保留其它字段） */
  updateScoreNotes: (stem: string, notes: CubyScore["tracks"][number]["notes"]) => void;
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
  melodyMode: "auto",
  arrangementMode: "polyphonic",
  maxSimultaneous: 4,
  detectChords: true,
  forceMonophonic: false,
  optimizePlayKey: false,
};

const POLL_INTERVAL_MS = 1200;

// ── 异步任务令牌：保证一次只有一个有效轮询写回 store ────────────────
interface JobToken { ctrl: AbortController; id: number }
let activeJob: JobToken | null = null;
let jobSeq = 0;

function startJob(): JobToken {
  activeJob?.ctrl.abort();
  const token: JobToken = { ctrl: new AbortController(), id: ++jobSeq };
  activeJob = token;
  return token;
}
function isCurrent(token: JobToken): boolean {
  return activeJob === token && !token.ctrl.signal.aborted;
}

// 切换/清除文件时的统一重置
function blankPatch() {
  return {
    task: null,
    parentTaskId: null,
    scores: {} as Record<string, ScoreEntry>,
    activeStems: [] as string[],
    stems: [] as StemInfo[],
    currentTime: 0,
  };
}

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
): { scores: Record<string, ScoreEntry>; activeStems: string[] } {
  const stem = meta.transcribedStem || "unknown";
  return {
    scores: { ...prevScores, [stem]: { score, meta } },
    activeStems: [stem, ...prevActive.filter((s) => s !== stem)],
  };
}

export const useStore = create<Store>((set, get) => ({
  file: null,
  audioUrl: null,
  options: DEFAULT_OPTIONS,
  ...blankPatch(),

  setFile: (f) => {
    activeJob?.ctrl.abort();
    activeJob = null;
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ file: f, audioUrl: f ? URL.createObjectURL(f) : null, ...blankPatch() });
  },

  setOptions: (o) => set({ options: { ...get().options, ...o } }),
  setCurrentTime: (t) => set({ currentTime: t }),

  toggleActiveStem: (stem) => {
    const { scores, activeStems } = get();
    if (!scores[stem]) return;
    const next = activeStems.includes(stem)
      ? activeStems.filter((s) => s !== stem)
      : [stem, ...activeStems];
    set({ activeStems: next });
  },

  updateScoreNotes: (stem, notes) => {
    const { scores } = get();
    const entry = scores[stem];
    if (!entry) return;
    const tracks = entry.score.tracks;
    const head = tracks[0] ?? { id: "track_1", name: "Melody", instrument: "sky_15", notes: [] };
    const nextScore: CubyScore = {
      ...entry.score,
      tracks: [{ ...head, notes }, ...tracks.slice(1)],
    };
    set({ scores: { ...scores, [stem]: { score: nextScore, meta: entry.meta } } });
  },

  reset: () => {
    activeJob?.ctrl.abort();
    activeJob = null;
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ file: null, audioUrl: null, ...blankPatch() });
  },

  startUpload: async () => {
    const { file, options } = get();
    if (!file) return;
    const job = startJob();

    set({
      task: { taskId: "", status: "queued", progress: 0, message: "uploading..." },
      stems: [],
      scores: {},
      activeStems: [],
    });

    let taskId: string;
    try {
      const r = await uploadAudio(file, options, job.ctrl.signal);
      if (!isCurrent(job)) return;
      taskId = r.taskId;
      set({ task: { taskId, status: "queued", progress: 5, message: "queued" }, parentTaskId: taskId });
    } catch (e) {
      if (!isCurrent(job)) return;
      const err = toAppError(e);
      if (err.code === "aborted") return;
      set({ task: { taskId: "", status: "failed", progress: 0, message: "upload failed", error: err.message } });
      return;
    }

    await pollUntilDone(taskId, job, (s) => {
      set({ task: s });
      if (s.status !== "completed") return;
      // 当未做分离时，后端 stems 为空 → 把"原音"做成一条虚拟 stem，
      // 使右侧 MixerPanel 仍能播放、且 transcribedStem='original' 能与之对齐。
      const { audioUrl, scores, activeStems } = get();
      let stems = s.stems ?? [];
      if (stems.length === 0 && audioUrl) {
        stems = [{ name: "original", url: audioUrl, duration: s.metadata?.duration ?? 0 }];
      }
      const patch: Partial<Store> = { stems };
      if (s.result && s.metadata) {
        Object.assign(patch, mergeScore(scores, activeStems, s.result, s.metadata));
      }
      set(patch);
    });
  },

  retranscribeWith: async (stem) => {
    const parent = get().parentTaskId;
    if (!parent) return;
    const job = startJob();
    // 关键：不再清空当前 score / meta；让用户在等待期间仍能查看 / 切换已有扒谱
    set({ task: { taskId: "", status: "processing", progress: 10, message: `retranscribing ${stem}…` } });
    try {
      const r = await retranscribeStem(parent, stem, job.ctrl.signal);
      if (!isCurrent(job)) return;
      await pollUntilDone(r.taskId, job, (s) => {
        set({ task: s });
        if (s.status === "completed" && s.result && s.metadata) {
          const { scores, activeStems } = get();
          set(mergeScore(scores, activeStems, s.result, s.metadata));
        }
      });
    } catch (e) {
      if (!isCurrent(job)) return;
      const err = toAppError(e);
      if (err.code === "aborted") return;
      set({ task: { taskId: "", status: "failed", progress: 0, message: "failed", error: err.message } });
    }
  },
}));

async function pollUntilDone(
  taskId: string,
  job: JobToken,
  onUpdate: (s: TaskState) => void,
): Promise<void> {
  while (isCurrent(job)) {
    await wait(POLL_INTERVAL_MS, job.ctrl.signal);
    if (!isCurrent(job)) return;
    try {
      const s = await getTask(taskId, job.ctrl.signal);
      if (!isCurrent(job)) return;
      onUpdate(s);
      if (s.status === "completed" || s.status === "failed") return;
    } catch (e) {
      if (!isCurrent(job)) return;
      const err = toAppError(e);
      if (err.code === "aborted") return;
      onUpdate({ taskId, status: "failed", progress: 0, message: "poll failed", error: err.message });
      return;
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = () => { window.clearTimeout(t); resolve(); };
    const t = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
