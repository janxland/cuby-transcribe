/**
 * 用 @tonejs/midi 解析 .mid/.midi → CubyScore（与 sheet.cuby.fun/editor 同款方案）。
 *
 * 编辑器历经多版打磨已验证 @tonejs/midi 在各种边角 MIDI 上稳定，
 * cuby-transcribe 不再维护手写 SMF 解析器。
 *
 * 输出约定（v2 · 100% 保真）：
 *  - Note.time / Note.duration 单位 = 秒（与 Python pipeline 一致）
 *  - Note.pitch **保留 MIDI 原值（0-127）**，光遇 15/25 键映射交给前端展示层处理
 *  - score.meta.ppq 保留 MIDI 文件原值，方便 toneClock 用 ticks
 */
import { Midi } from "@tonejs/midi";
import type { CubyScore, Note, Track } from "@/types";

export interface ParsedMidi {
  score: CubyScore;
  durationSec: number;
  rawPitchRange: { min: number; max: number };
}

export async function parseMidiFile(file: File): Promise<ParsedMidi> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);

  const bpm = midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm * 100) / 100
    : 120;
  const tsig = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const ppq = midi.header.ppq || 480;

  const allRawPitches: number[] = [];
  const tracks: Track[] = [];

  midi.tracks.forEach((tk, idx) => {
    if (tk.notes.length === 0) return;
    const notes: Note[] = tk.notes.map((n) => {
      allRawPitches.push(n.midi);
      return {
        pitch: n.midi,                         // 保真：不再折叠到 25 键
        time: n.time,
        duration: Math.max(0.05, n.duration),
        velocity: Math.max(1, Math.round(n.velocity * 127)),
      };
    });
    tracks.push({
      id: String(idx + 1),
      name: tk.name || `Track ${idx + 1}`,
      instrument: tk.instrument?.name || "Grand Piano",
      notes,
    });
  });

  const totalNotes = tracks.reduce((s, t) => s + t.notes.length, 0);
  if (totalNotes === 0) throw new Error("MIDI 文件里没有可播放的音符");

  let durationSec = 0;
  for (const t of tracks) {
    for (const n of t.notes) {
      if (n.time + n.duration > durationSec) durationSec = n.time + n.duration;
    }
  }

  const score: CubyScore = {
    version: "1.1",
    meta: {
      title: midi.name || file.name.replace(/\.(midi?|MID|MIDI)$/i, ""),
      composer: "MIDI Import",
      bpm,
      timeSignature: `${tsig[0]}/${tsig[1]}`,
      keySignature: "C",
      ppq,
    },
    tracks,
  };

  return {
    score,
    durationSec,
    rawPitchRange: {
      min: allRawPitches.length ? Math.min(...allRawPitches) : 0,
      max: allRawPitches.length ? Math.max(...allRawPitches) : 0,
    },
  };
}
