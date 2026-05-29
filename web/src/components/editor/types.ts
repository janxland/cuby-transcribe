/**
 * 编辑器内部类型 —— 故意与全局 `Note` 隔离：
 *  - 每个音符额外携带稳定 `id`，便于选择/撤销/比较；
 *  - 提交回 store 时由 `serialize()` 剥离 id 并取整 → 与外部 `CubyScore.Note` 等价。
 */
import type { Note as ScoreNote } from "../../types";

export interface EditorNote {
  id: string;
  pitch: number;     // MIDI
  time: number;      // seconds
  duration: number;  // seconds, > 0
  velocity: number;  // 1..127
}

export type Tool = "select" | "draw" | "erase";

export interface EditorViewport {
  pxPerSec: number;
  rowH: number;
  pitchMin: number; // 含
  pitchMax: number; // 含
}

export interface GridConfig {
  /** 一拍切几份；4 / 8 / 16 / 32 */
  division: 4 | 8 | 16 | 32;
  /** 关闭时所有拖动/绘制都不吸附 */
  snap: boolean;
}

export const fromScoreNotes = (notes: ScoreNote[]): EditorNote[] =>
  notes.map((n, i) => ({
    id: `n${i}_${Math.random().toString(36).slice(2, 8)}`,
    pitch: n.pitch,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity ?? 90,
  }));

export const toScoreNotes = (notes: EditorNote[]): ScoreNote[] =>
  notes
    .map((n) => ({
      pitch: n.pitch,
      time: round4(n.time),
      duration: round4(Math.max(0.01, n.duration)),
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
    }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);

const round4 = (x: number) => Math.round(x * 10000) / 10000;
