export type RecorderStatus = "idle" | "recording" | "paused" | "stopping" | "ready" | "error";
export type RecorderInput = "microphone" | "system";
export type RecorderTranscribeMode = "humming" | "instrument";

export interface RecordedClip {
  blob: Blob;
  file: File;
  url: string;
  durationMs: number;
  mimeType: string;
  source: RecorderInput;
}

export interface RecorderSnapshot {
  status: RecorderStatus;
  input: RecorderInput;
  elapsedMs: number;
  level: number;
  waveform: number[];
  clip: RecordedClip | null;
  error: string | null;
  supported: boolean;
  supportsSystemAudio: boolean;
}
