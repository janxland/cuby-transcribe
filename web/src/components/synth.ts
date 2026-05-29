/**
 * 15 键弹奏用的轻量合成器 —— 纯 WebAudio，不依赖采样资源。
 * 每个预设是一个"按 MIDI 音高一次性触发"的函数；外部只关心 play(preset, pitch)。
 */

export type PresetId = "piano" | "musicbox" | "bell" | "pluck" | "pad";

export interface Preset {
  id: PresetId;
  label: string;
  icon: string;
}

export const PRESETS: Preset[] = [
  { id: "piano",    label: "钢琴",   icon: "🎹" },
  { id: "musicbox", label: "八音盒", icon: "🎶" },
  { id: "bell",     label: "钟声",   icon: "🔔" },
  { id: "pluck",    label: "拨弦",   icon: "🎸" },
  { id: "pad",      label: "音垫",   icon: "🌫️" },
];

// ─── AudioContext 单例 ────────────────────────────────────────
let _ctx: AudioContext | null = null;
let _master: GainNode | null = null;

function ctx(): AudioContext {
  if (!_ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    _ctx = new AC();
    _master = _ctx.createGain();
    _master.gain.value = 0.7;
    _master.connect(_ctx.destination);
  }
  return _ctx;
}

function master(): GainNode {
  ctx();
  return _master!;
}

export async function ensureSynthAudio(): Promise<void> {
  const c = ctx();
  if (c.state === "suspended") await c.resume();
}

export function setSynthVolume(v: number): void {
  master().gain.value = Math.max(0, Math.min(1, v));
}

export function getSynthVolume(): number {
  return master().gain.value;
}

// ─── MIDI → Hz ────────────────────────────────────────────────
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ─── 音色实现 ─────────────────────────────────────────────────
function playPiano(c: AudioContext, dst: AudioNode, freq: number, t0: number) {
  // 多谐波叠加 + 快速衰减；模拟敲击式
  const dur = 1.8;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(dst);

  const partials: Array<[number, number]> = [
    [1, 1.0], [2, 0.5], [3, 0.25], [4, 0.18], [6, 0.08],
  ];
  for (const [n, amp] of partials) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * n;
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function playMusicBox(c: AudioContext, dst: AudioNode, freq: number, t0: number) {
  const dur = 2.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.45, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(dst);

  // 高谐波突出的金属感
  const partials: Array<[number, number]> = [
    [1, 1.0], [3, 0.7], [6, 0.4], [9, 0.2],
  ];
  for (const [n, amp] of partials) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * n;
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function playBell(c: AudioContext, dst: AudioNode, freq: number, t0: number) {
  const dur = 3.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(dst);

  // 不和谐分音 → 钟声
  const partials: Array<[number, number]> = [
    [0.5, 0.5], [1, 1.0], [2.4, 0.55], [4.2, 0.3], [5.6, 0.18],
  ];
  for (const [n, amp] of partials) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * n;
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function playPluck(c: AudioContext, dst: AudioNode, freq: number, t0: number) {
  // 单震荡 + 低通包络 → 拨弦感
  const dur = 1.2;
  const o = c.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = freq;

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(freq * 6, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq), t0 + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.35, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

  o.connect(lp).connect(g).connect(dst);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function playPad(c: AudioContext, dst: AudioNode, freq: number, t0: number) {
  // 慢起慢落 + 失谐叠加
  const dur = 2.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.3, t0 + 0.25);
  g.gain.setValueAtTime(0.3, t0 + dur - 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(dst);

  for (const detune of [-7, 0, 7]) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    o.detune.value = detune;
    const og = c.createGain();
    og.gain.value = 0.5;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

const IMPL: Record<PresetId, (c: AudioContext, dst: AudioNode, f: number, t: number) => void> = {
  piano: playPiano,
  musicbox: playMusicBox,
  bell: playBell,
  pluck: playPluck,
  pad: playPad,
};

/** 立即触发一个音符。返回 Promise 仅用于 ensureSynthAudio。 */
export async function playNote(preset: PresetId, midi: number): Promise<void> {
  await ensureSynthAudio();
  const c = ctx();
  const f = midiToHz(midi);
  IMPL[preset](c, master(), f, c.currentTime);
}
