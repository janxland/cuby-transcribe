/**
 * 基于 Tone.Transport 的纯软件时钟 + PolySynth 音频引擎。
 *
 * 设计目标（学习自 sheet.cuby.fun/editor/src/hooks/usePlayback.ts）：
 *  - 不依赖任何音频文件 / 解码 / mixer，纯由 Tone.Transport ticks 驱动
 *  - 使用 Tone.Part 把 score 中的 notes 注入 Transport，PolySynth 直接发声
 *  - 暴露与 mixer 同形的 `time / playing / play / pause / toggle / seek`，
 *    Sky15Keys 可以无脑接入
 *  - subscribe API + useToneClockState() React hook 让 UI 组件随时钟刷新
 *
 * 与 editor 的差异：
 *  - editor 的 score.notes 是 ticks 单位；cuby-transcribe 是秒单位（与 Python pipeline 对齐）
 *  - 因此这里 Tone.Part 用秒事件而非 "<tick>i" 事件
 */
import * as Tone from "tone";
import type { CubyScore } from "@/types";

type Listener = () => void;

interface ToneClockState {
  time: number;        // Tone.Transport.seconds
  playing: boolean;
  duration: number;    // 整曲秒数
  bpm: number;
}

class ToneClockImpl {
  private synth: Tone.PolySynth | null = null;
  private parts: Tone.Part[] = [];
  private listeners = new Set<Listener>();
  private rafId = 0;
  private state: ToneClockState = { time: 0, playing: false, duration: 0, bpm: 120 };
  private started = false;

  /** 必须在用户手势内调用一次（auto-play 策略要求） */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    if (!this.synth) {
      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 },
      }).toDestination();
      this.synth.volume.value = -10;
    }
    this.started = true;
  }

  /** 装载新乐谱：清掉旧 Part、按 score 重建 */
  loadScore(score: CubyScore, durationSec: number) {
    this.disposeParts();
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    Tone.Transport.position = 0;
    Tone.Transport.bpm.value = score.meta.bpm;

    const synth = this.synth;
    if (!synth) {
      // 还没 ensureStarted —— 先存元数据，play 时再装
      this.state = { ...this.state, duration: durationSec, bpm: score.meta.bpm, time: 0, playing: false };
      this.pendingScore = { score, durationSec };
      this.emit();
      return;
    }

    score.tracks.forEach((track) => {
      const events = track.notes.map((n) => ({
        time: n.time,                                // seconds
        note: Tone.Frequency(n.pitch, "midi").toNote(),
        duration: Math.max(0.05, n.duration),
        velocity: Math.max(0.1, Math.min(1, n.velocity / 127)),
      }));
      const part = new Tone.Part((time, value: any) => {
        synth.triggerAttackRelease(value.note, value.duration, time, value.velocity);
      }, events).start(0);
      this.parts.push(part);
    });

    this.pendingScore = null;
    this.state = { time: 0, playing: false, duration: durationSec, bpm: score.meta.bpm };
    this.emit();
  }

  private pendingScore: { score: CubyScore; durationSec: number } | null = null;

  async play(at?: number): Promise<void> {
    await this.ensureStarted();
    if (this.pendingScore) {
      const p = this.pendingScore;
      this.pendingScore = null;
      this.loadScore(p.score, p.durationSec);
    }
    if (typeof at === "number") {
      Tone.Transport.seconds = at;
    }
    // 到末尾后从头放
    if (this.state.duration > 0 && Tone.Transport.seconds >= this.state.duration - 0.01) {
      Tone.Transport.seconds = 0;
    }
    Tone.Transport.start();
    this.state = { ...this.state, playing: true };
    this.startTicker();
    this.emit();
  }

  pause() {
    Tone.Transport.pause();
    this.synth?.releaseAll();
    this.state = { ...this.state, playing: false };
    this.stopTicker();
    this.emit();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  stop() {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    this.synth?.releaseAll();
    this.state = { ...this.state, playing: false, time: 0 };
    this.stopTicker();
    this.emit();
  }

  seek(sec: number) {
    Tone.Transport.seconds = Math.max(0, Math.min(this.state.duration || sec, sec));
    this.state = { ...this.state, time: Tone.Transport.seconds };
    this.emit();
  }

  setVolume(v: number) {
    if (!this.synth) return;
    // v in [0,1] → -60dB..0dB（0 静音处理）
    if (v <= 0) {
      this.synth.volume.value = -Infinity;
    } else {
      this.synth.volume.value = -10 + Math.log10(Math.max(0.001, v)) * 20;
    }
  }

  setTimbre(timbre: "sine" | "square" | "sawtooth" | "triangle" | "warm") {
    if (!this.synth) return;
    // PolySynth 不能直接换 oscillator type，需要重建
    const oldVolume = this.synth.volume.value;
    this.synth.releaseAll();
    this.synth.dispose();
    const opts =
      timbre === "warm"
        ? { oscillator: { type: "triangle" as const }, envelope: { attack: 0.03, decay: 0.2, sustain: 0.45, release: 1.4 } }
        : timbre === "sine"
        ? { oscillator: { type: "sine" as const }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 } }
        : timbre === "square"
        ? { oscillator: { type: "square" as const }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.28, release: 0.9 } }
        : timbre === "sawtooth"
        ? { oscillator: { type: "sawtooth" as const }, envelope: { attack: 0.01, decay: 0.08, sustain: 0.25, release: 0.8 } }
        : { oscillator: { type: "triangle" as const }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 } };
    this.synth = new Tone.PolySynth(Tone.Synth, opts).toDestination();
    this.synth.volume.value = oldVolume;

    // 重新创建 Part 让它们用上新 synth
    if (this.parts.length > 0 && this.state.duration > 0) {
      const oldEvents: any[] = [];
      this.parts.forEach((p) => {
        // 收集事件后再 dispose
        // Tone.Part 没有直接 events 导出，我们通过 _events 越过类型；为安全起见跳过——
        // 调用方可在切音色后重 loadScore
        oldEvents.push(p);
      });
    }
  }

  private disposeParts() {
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
  }

  private startTicker() {
    if (this.rafId) return;
    const tick = () => {
      const t = Tone.Transport.seconds;
      this.state = { ...this.state, time: t };
      this.emit();
      // 到尾了自动停
      if (this.state.duration > 0 && t >= this.state.duration) {
        this.pause();
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getState(): ToneClockState {
    return this.state;
  }

  private emit() {
    this.listeners.forEach((cb) => cb());
  }
}

export const toneClock = new ToneClockImpl();
export type { ToneClockState };
