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
}

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export type SeparationMode = "none" | "vocals" | "4stems";

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
  transposeToC: boolean;
  simplifyMelody: boolean;
  quantizeGrid: 8 | 16;
  separationMode: SeparationMode;
  transcribeStem?: StemName;
}
