/**
 * 编辑器纯几何 / 时值换算 —— 无 React、无 DOM，便于单元测试。
 * 所有 px <-> time / pitch <-> y 都从这里出，杜绝魔法常量散落。
 */
import type { EditorViewport, GridConfig } from "./types";

export const timeToX = (t: number, v: EditorViewport) => t * v.pxPerSec;
export const xToTime = (x: number, v: EditorViewport) => x / v.pxPerSec;

/** 屏幕坐标 y → MIDI pitch（pitchMax 在顶部） */
export const yToPitch = (y: number, v: EditorViewport) =>
  v.pitchMax - Math.floor(y / v.rowH);

/** MIDI pitch → 屏幕 y（行顶） */
export const pitchToY = (pitch: number, v: EditorViewport) =>
  (v.pitchMax - pitch) * v.rowH;

export const clampPitch = (pitch: number, v: EditorViewport) =>
  Math.max(v.pitchMin, Math.min(v.pitchMax, pitch));

/** 一拍 = 60/bpm 秒；一个 grid step = 一拍/division */
export const gridStep = (bpm: number, g: GridConfig) => (60 / bpm) / (g.division / 4);

/** 量化到最近 grid 起点；snap 关闭时原样返回（仍 clamp ≥0） */
export function snapTime(t: number, bpm: number, g: GridConfig): number {
  if (!g.snap) return Math.max(0, t);
  const step = gridStep(bpm, g);
  return Math.max(0, Math.round(t / step) * step);
}

/** 自然音名 + 八度 */
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const pitchName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
export const isWhiteKey = (p: number) =>
  new Set([0, 2, 4, 5, 7, 9, 11]).has(p % 12);

/** 命中测试：返回点击落在哪条音符上 / 音符的右侧 resize 把手内 */
export interface Hit {
  id: string;
  zone: "body" | "right";
}
export function hitTest(
  px: number, py: number,
  notes: { id: string; pitch: number; time: number; duration: number }[],
  v: EditorViewport,
  resizeHandle = 8,
): Hit | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const x = timeToX(n.time, v);
    const w = Math.max(3, timeToX(n.duration, v));
    const y = pitchToY(n.pitch, v);
    if (px >= x && px <= x + w && py >= y + 1 && py <= y + v.rowH - 1) {
      return { id: n.id, zone: px >= x + w - resizeHandle ? "right" : "body" };
    }
  }
  return null;
}
