/**
 * 音乐相关纯工具：避免 PianoRoll / Sky15Keys / Editor 各处重复定义。
 */

export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** 自然音 pitch class（白键） */
export const NATURAL_PCS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);

/** MIDI pitch → "C4" 这样的科学音名（C4 = 60） */
export function pitchName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${PITCH_NAMES[pc]}${oct}`;
}

/** 仅取 pitch class 名（不带八度） */
export function pitchClassName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return PITCH_NAMES[pc];
}

export function isBlackKey(midi: number): boolean {
  return !NATURAL_PCS.has(((midi % 12) + 12) % 12);
}
