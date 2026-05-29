export interface Note {
  pitch: number;       // MIDI 60-84
  time: number;        // seconds
  duration: number;    // seconds
  velocity: number;    // 0-127
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
}

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  progress: number;
  message: string;
  result?: CubyScore;
  metadata?: Metadata;
  error?: string;
}

export interface UploadOptions {
  transposeToC: boolean;
  simplifyMelody: boolean;
  quantizeGrid: 8 | 16;
}
