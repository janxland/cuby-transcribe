/**
 * editor 风格轻量合成器：
 *  - 音色集合对齐 editor：triangle / sine / square / sawtooth / warm
 *  - 每次触发都显式接收 note.duration 和 velocity，长音不再只是“亮得更久”
 */

export type PresetId = "triangle" | "sine" | "square" | "sawtooth" | "warm";

export interface Preset {
  id: PresetId;
  label: string;
  icon: string;
}

export const PRESETS: Preset[] = [
  { id: "triangle", label: "默认", icon: "△" },
  { id: "sine", label: "正弦", icon: "∿" },
  { id: "square", label: "方波", icon: "⊓" },
  { id: "sawtooth", label: "锯齿", icon: "⟍" },
  { id: "warm", label: "温暖", icon: "◔" },
];

interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  peak: number;
  gainScale: number;
  osc: OscillatorType;
  detunes?: number[];
  longDecay: number;
  brightness: [number, number];
  q?: number;
}

const ENVELOPES: Record<PresetId, Envelope> = {
  triangle: {
    osc: "triangle", attack: 0.01, decay: 0.1, sustain: 0.34, release: 1.0,
    peak: 1.0, gainScale: 0.31, longDecay: 0.52, brightness: [8.5, 2.6], q: 1.8,
  },
  sine: {
    osc: "sine", attack: 0.01, decay: 0.1, sustain: 0.32, release: 1.05,
    peak: 1.0, gainScale: 0.28, longDecay: 0.58, brightness: [6.5, 2.8], q: 1.2,
  },
  square: {
    osc: "square", attack: 0.008, decay: 0.09, sustain: 0.26, release: 0.9,
    peak: 0.92, gainScale: 0.21, longDecay: 0.46, brightness: [7.2, 2.1], q: 2.4,
  },
  sawtooth: {
    osc: "sawtooth", attack: 0.008, decay: 0.08, sustain: 0.23, release: 0.82,
    peak: 0.88, gainScale: 0.2, longDecay: 0.42, brightness: [7.8, 1.9], q: 2.2,
  },
  warm: {
    osc: "triangle", attack: 0.03, decay: 0.2, sustain: 0.45, release: 1.45,
    peak: 0.95, gainScale: 0.29, detunes: [-4, 0, 4], longDecay: 0.64, brightness: [6.8, 2.4], q: 1.5,
  },
};

let _ctx: AudioContext | null = null;
let _master: GainNode | null = null;
let _compressor: DynamicsCompressorNode | null = null;

function ctx(): AudioContext {
  if (!_ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    _ctx = new AC();
    _compressor = _ctx.createDynamicsCompressor();
    _compressor.threshold.value = -18;
    _compressor.knee.value = 18;
    _compressor.ratio.value = 3;
    _compressor.attack.value = 0.003;
    _compressor.release.value = 0.18;
    _master = _ctx.createGain();
    _master.gain.value = 1.15;
    _master.connect(_compressor);
    _compressor.connect(_ctx.destination);
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

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function scheduleVoice(
  c: AudioContext,
  dst: AudioNode,
  freq: number,
  t0: number,
  durationSec: number,
  velocity: number,
  cfg: Envelope,
): void {
  const noteDur = Math.max(0.08, Math.min(12, durationSec));
  const amp = Math.max(0.03, Math.min(1, velocity / 127)) * cfg.gainScale;
  const peak = amp * cfg.peak;
  const sustain = Math.max(0.0001, peak * cfg.sustain);
  const attackEnd = t0 + cfg.attack;
  const decayEnd = attackEnd + cfg.decay;
  const releaseStart = Math.max(t0 + noteDur, decayEnd);
  const stopAt = releaseStart + cfg.release + 0.05;
  const heldTail = Math.max(0.0001, sustain * cfg.longDecay);
  const longDecayEnd = Math.max(decayEnd + 0.06, releaseStart);

  const detunes = cfg.detunes?.length ? cfg.detunes : [0];
  const mix = 1 / detunes.length;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = cfg.q ?? 1.5;
  filter.frequency.setValueAtTime(Math.max(300, freq * cfg.brightness[0]), t0);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(180, freq * cfg.brightness[1]),
    Math.max(decayEnd + 0.03, releaseStart),
  );

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), attackEnd);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), decayEnd);
  gain.gain.exponentialRampToValueAtTime(heldTail, longDecayEnd);
  gain.gain.setValueAtTime(heldTail, releaseStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart + cfg.release);
  filter.connect(gain).connect(dst);

  for (const detune of detunes) {
    const osc = c.createOscillator();
    osc.type = cfg.osc;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(detune, t0);

    const voiceGain = c.createGain();
    voiceGain.gain.value = mix;
    osc.connect(voiceGain).connect(filter);
    osc.start(t0);
    osc.stop(stopAt);
  }
}

/** 立即触发一个音符，默认给一个短音时值。 */
export async function playNote(
  preset: PresetId,
  midi: number,
  durationSec = 0.35,
  velocity = 96,
): Promise<void> {
  await ensureSynthAudio();
  const c = ctx();
  const freq = midiToHz(midi);
  const cfg = ENVELOPES[preset];
  scheduleVoice(c, master(), freq, c.currentTime, durationSec, velocity, cfg);
}
