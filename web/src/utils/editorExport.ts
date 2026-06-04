import type { CubyScore, Metadata, Note } from "@/types";

type EditorTimeSignature = [number, number];

interface EditorNote {
  pitch: number;
  time: number;
  duration: number;
  velocity: number;
}

interface EditorTrack {
  id: number;
  name: string;
  instrument: string;
  notes: EditorNote[];
}

interface EditorScore {
  version: string;
  meta: {
    title: string;
    composer: string;
    bpm: number;
    timeSignature: EditorTimeSignature;
    keySignature: string;
    ppq: number;
  };
  tracks: EditorTrack[];
}

const MELODY_VELOCITY_FLOOR = 90;

function parseTimeSignature(input: string | undefined): EditorTimeSignature {
  if (!input) return [4, 4];
  const match = input.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!match) return [4, 4];
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return [4, 4];
  }
  return [numerator, denominator];
}

function secondsToTicks(seconds: number, bpm: number, ppq: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const beats = seconds / (60 / Math.max(1, bpm));
  return Math.round(beats * ppq);
}

function splitTracks(notes: Note[], meta?: Metadata): [Note[], Note[]] {
  if ((meta?.arrangementMode ?? "monophonic") !== "polyphonic") {
    return [notes, []];
  }
  const melody = notes.filter((note) => note.velocity >= MELODY_VELOCITY_FLOOR);
  const chord = notes.filter((note) => note.velocity < MELODY_VELOCITY_FLOOR);
  if (!melody.length || !chord.length) {
    return [notes, []];
  }
  return [melody, chord];
}

function toEditorNotes(notes: Note[], bpm: number, ppq: number): EditorNote[] {
  return notes
    .map((note) => ({
      pitch: note.pitch,
      time: Math.max(0, secondsToTicks(note.time, bpm, ppq)),
      duration: Math.max(1, secondsToTicks(note.duration, bpm, ppq)),
      velocity: note.velocity,
    }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}

export function toEditorScore(score: CubyScore, meta?: Metadata): EditorScore {
  const bpm = Number.isFinite(score.meta?.bpm) && score.meta.bpm > 0 ? score.meta.bpm : 120;
  const ppq = Number.isFinite(score.meta?.ppq) && score.meta.ppq > 0 ? score.meta.ppq : 480;
  const tracks = score.tracks ?? [];
  const [melodyNotes, chordNotes] = tracks.length >= 2
    ? [tracks[0]?.notes ?? [], tracks[1]?.notes ?? []]
    : splitTracks(tracks[0]?.notes ?? [], meta);

  return {
    version: score.version || "1.1",
    meta: {
      title: score.meta?.title || "Untitled",
      composer: score.meta?.composer || "AI Transcribed",
      bpm,
      timeSignature: parseTimeSignature(score.meta?.timeSignature),
      keySignature: score.meta?.keySignature || "C",
      ppq,
    },
    tracks: [
      {
        id: 1,
        name: "Melody",
        instrument: "Grand Piano",
        notes: toEditorNotes(melodyNotes, bpm, ppq),
      },
      {
        id: 2,
        name: "Chord",
        instrument: "Grand Piano",
        notes: toEditorNotes(chordNotes, bpm, ppq),
      },
    ],
  };
}
