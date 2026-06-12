// StemName 与 STEM_REGISTRY 同源派生，避免重复枚举
import type { StemName } from "./stems";

export interface Note {
  pitch: number;
  time: number;
  duration: number;
  velocity: number;
}

export interface Track {
  id: string;
  name: string;
  instrument: string;
  notes: Note[];
}

export interface CubyScore {
  version: string;
  meta: {
    title: string;
    composer: string;
    bpm: number;
    timeSignature: string;
    keySignature: string;
    ppq: number;
  };
  tracks: Track[];
}

export interface Metadata {
  detectedKey: string;
  detectedMode: string;
  bpm: number;
  duration: number;
  noteCount: number;
  elapsed: number;
  transcribedStem: string;
  /** 'basic_pitch' 复音 | 'pyin' 人声单音旋律 | 'basic_pitch+skyline' 单音模式 */
  melodyAlgo?: string;
  /** 实际生效的编配模式：'polyphonic' | 'monophonic' */
  arrangementMode?: "polyphonic" | "monophonic";
  /** polyphonic 模式下全曲同时按键峰值 */
  maxConcurrent?: number;
  /** 识别到的和弦序列（每段 [start,end,label,root,quality]） */
  chords?: ChordSegment[] | null;
  /** 建议在游戏内按下的升降调键半音数，正=升 */
  recommendedShift?: number | null;
  /** 推荐玩家手感调（如 D / Eb …） */
  playableKey?: string | null;
  /** 实际生效的保真模式 */
  fidelityMode?: "raw" | "arranged";
  /** raw 模式下每条 stem 用了什么算法 */
  perStemAlgo?: Record<string, string> | null;
  /** BPM 来源：user(手填) / detected(自动检测) / refined(自动纠偏) */
  tempoSource?: "user" | "detected" | "refined" | string;
}

export interface ChordSegment {
  start: number;
  end: number;
  label: string;     // "C", "Am", "G7" 等
  root: number;      // 0..11 pc
  quality: string;   // "maj"|"min"|...
}

export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "canceled";

export type SeparationMode = "none" | "vocals" | "4stems" | "6stems";

export interface StemInfo {
  name: string;
  url: string;
  duration: number;
}

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  progress: number;
  message: string;
  result?: CubyScore;
  metadata?: Metadata;
  stems?: StemInfo[];
  error?: string;
}

export interface UploadOptions {
  /** 'raw' = 100% 保真多 stem 多 track 扒谱（默认）；'arranged' = 旧版光遇键盘适配 */
  fidelityMode?: "raw" | "arranged";
  /** 分离质量：fast 更快；high 更稳 */
  separationQuality?: "fast" | "high";
  transposeToC: boolean;
  simplifyMelody: boolean;
  quantizeGrid: 8 | 16;
  /** 由 stems 自动派生，提交给 backend 决定 demucs 模型 */
  separationMode: SeparationMode;
  /** 用户希望保留/试听的音轨集合（多选） */
  stems: StemName[];
  /** 指定要扒谱的目标 stem；缺省时取 stems[0] */
  transcribeStem?: StemName;
  /** 当目标是人声时，自动转成 25 键可按演奏 */
  vocalToSky25?: boolean;
  /** 旋律提取模式：auto=Basic Pitch复音，vocal=PYIN 人声单音（需 transcribeStem=vocals） */
  melodyMode?: "auto" | "vocal";
  /** 编配模式：polyphonic 保留和弦/和声 · monophonic 强行单音 */
  arrangementMode?: "polyphonic" | "monophonic";
  /** 同帧最大并发音数（polyphonic 生效，建议 2-4） */
  maxSimultaneous?: number;
  /** 启用和弦识别（polyphonic 必备；monophonic 仅作展示） */
  detectChords?: boolean;
  /** 旧字段（兼容）：强制单旋律 = arrangementMode='monophonic' */
  forceMonophonic?: boolean;
  /** 开启后枚举最佳可弹奏调，输出推荐「升降调键」 */
  optimizePlayKey?: boolean;
  /** 手动 BPM；留空时自动检测并纠偏 */
  manualBpm?: number | null;
}

export type ScoreCleanupProvider = "auto" | "local_ai" | "anthem_score" | "midi_cleaner_ai";

export interface ScoreCleanupOptions {
  provider: ScoreCleanupProvider;
  removeOneThirtySecondNoise: boolean;
  minDivision: 32;
  targetBpm?: number | null;
  preserveMelody: boolean;
}

export interface ScoreCleanupStats {
  before: number;
  after: number;
  removedOneThirtySecond: number;
  provider: string;
  message: string;
}
