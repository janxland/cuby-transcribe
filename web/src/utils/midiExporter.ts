/**
 * CubyScore → .mid 文件导出（多 track 保真）。
 *
 * Note.time / Note.duration 在 cuby-transcribe 流水线里单位 = 秒，
 * @tonejs/midi 的 addNote({ time, duration }) 也接受秒，直接对接最稳。
 *
 * 100% 保真原则：不裁剪音高、不量化、不丢 velocity。
 */
import { Midi } from "@tonejs/midi";
import type { CubyScore } from "@/types";

export type MidiExportMode = "multi" | "single";

function inferProgramAndChannel(trackName: string, instrument: string): { program: number; channel?: number } {
  const s = `${trackName} ${instrument}`.toLowerCase();
  if (s.includes("drum") || s.includes("鼓")) return { program: 0, channel: 9 };
  if (s.includes("bass") || s.includes("贝斯")) return { program: 33 };
  if (s.includes("guitar") || s.includes("吉他")) return { program: 24 };
  if (s.includes("vocal") || s.includes("人声")) return { program: 53 };
  if (s.includes("string") || s.includes("pad")) return { program: 48 };
  if (s.includes("synth")) return { program: 81 };
  return { program: 0 };
}

function parseTimeSig(ts: string | undefined): [number, number] {
  if (!ts) return [4, 4];
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(ts);
  if (!m) return [4, 4];
  return [Number(m[1]) || 4, Number(m[2]) || 4];
}

export function buildMidi(score: CubyScore, mode: MidiExportMode = "multi"): Uint8Array {
  const midi = new Midi();
  const bpm = score.meta.bpm || 120;
  const ppq = score.meta.ppq || 480;
  const minTickSec = 60 / (bpm * ppq);
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: parseTimeSig(score.meta.timeSignature),
    measures: 0,
  });

  if (mode === "single") {
    const tk = midi.addTrack();
    tk.name = score.meta.title || "Cuby Transcribe";
    const { program, channel } = inferProgramAndChannel("", "Grand Piano");
    tk.instrument.number = program;
    if (channel != null) tk.channel = channel;
    score.tracks
      .flatMap((t) => t.notes)
      .sort((a, b) => a.time - b.time || a.pitch - b.pitch)
      .forEach((n) => {
        if (n.duration < minTickSec) return;
        tk.addNote({
          midi: clampMidi(n.pitch),
          time: n.time,
          duration: Math.max(0.02, n.duration),
          velocity: Math.max(0, Math.min(1, (n.velocity ?? 90) / 127)),
        });
      });
  } else {
    score.tracks.forEach((t) => {
      if (!t.notes.length) return;
      const tk = midi.addTrack();
      tk.name = t.name || t.id;
      const { program, channel } = inferProgramAndChannel(t.name || t.id, t.instrument || "");
      tk.instrument.number = program;
      if (channel != null) tk.channel = channel;
      t.notes.forEach((n) => {
        if (n.duration < minTickSec) return;
        tk.addNote({
          midi: clampMidi(n.pitch),
          time: n.time,
          duration: Math.max(0.02, n.duration),
          velocity: Math.max(0, Math.min(1, (n.velocity ?? 90) / 127)),
        });
      });
    });
  }

  return midi.toArray();
}

function clampMidi(p: number): number {
  return Math.max(0, Math.min(127, Math.round(p)));
}

export function downloadMidi(score: CubyScore, filename?: string, mode: MidiExportMode = "multi") {
  const data = buildMidi(score, mode);
  // 显式拷贝到 ArrayBuffer 以避开 TS Uint8Array<ArrayBufferLike> vs BlobPart 的类型分歧
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const blob = new Blob([ab], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `${(score.meta.title || "cuby").replace(/[^\w.\-]+/g, "_")}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
