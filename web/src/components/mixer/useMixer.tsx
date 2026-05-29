/**
 * Mixer 状态 + 控制器 hook（引擎驱动版）
 *
 *  - 不使用 HTMLAudioElement；所有 BufferSource 用同一 ctx.currentTime + LOOKAHEAD 启动
 *  - 播放进度 = ctx.currentTime - startedAt + startedFrom（采样精确）
 *  - 操作（pause / seek / play 切换）会同步取消 rAF，避免覆盖刚 set 的 time
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import {
  audioContext, mixGraph, resumeAudio, ensureTrack, waitForDecode,
  startTrack, stopAllTracks, trackGain, trackAnalyser, trackDuration,
} from "./audio";
import { safeDur, safeTime } from "./utils";

const LOOKAHEAD = 0.06;            // 60ms 调度前置量
const DEFAULT_TRACK_VOL = 0.85;
const DEFAULT_MASTER_VOL = 0.8;
const DEFAULT_STATE: TrackState = { volume: DEFAULT_TRACK_VOL, muted: false, solo: false };

// ─── 类型 ─────────────────────────────────────────────────────────
export interface MixerTrackInput { name: string; url: string; duration: number; }
export interface TrackState { volume: number; muted: boolean; solo: boolean; }

export interface MixerApi {
  tracks: MixerTrackInput[];
  trackStates: Record<string, TrackState>;
  master: { volume: number; muted: boolean };
  time: number;
  duration: number;
  playing: boolean;
  loading: boolean;

  play(from?: number): Promise<void>;
  pause(): void;
  toggle(): void;
  seek(t: number): void;

  setVolume(name: string, v: number): void;
  toggleMute(name: string): void;
  toggleSolo(name: string): void;
  setMaster(v: number): void;
  toggleMasterMute(): void;

  getAnalyser(name: string): AnalyserNode | null;
}

// ─── 实现 ─────────────────────────────────────────────────────────
function useMixerImpl(tracks: MixerTrackInput[]): MixerApi {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({});
  const [master, setMasterState] = useState({ volume: DEFAULT_MASTER_VOL, muted: false });

  const startedAtRef = useRef(0);    // ctx.currentTime when current play began
  const startedFromRef = useRef(0);  // buffer offset (秒)
  const rafRef = useRef<number | null>(null);

  const cancelTick = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // ── 注册音轨 + 启动解码 ─────────────────────────────────────
  useEffect(() => {
    if (!tracks.length) return;
    setLoading(true);
    for (const t of tracks) ensureTrack(t.name, t.url, DEFAULT_TRACK_VOL);

    setTrackStates((cur) => {
      const next: Record<string, TrackState> = {};
      for (const t of tracks) next[t.name] = cur[t.name] ?? DEFAULT_STATE;
      return next;
    });

    const metaDur = tracks.reduce(
      (a, t) => Math.max(a, Number.isFinite(t.duration) ? t.duration : 0), 0,
    );
    if (metaDur > 0) setDuration((cur) => Math.max(cur, metaDur));

    let cancelled = false;
    waitForDecode(tracks.map((t) => t.name)).then(() => {
      if (cancelled) return;
      const d = tracks.reduce((a, t) => Math.max(a, trackDuration(t.name)), 0);
      if (d > 0) setDuration(d);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tracks]);

  // ── solo/mute/volume → 实时同步 GainNode ────────────────────
  const anySolo = useMemo(
    () => Object.values(trackStates).some((s) => s.solo),
    [trackStates],
  );
  useEffect(() => {
    for (const t of tracks) {
      const g = trackGain(t.name);
      const st = trackStates[t.name];
      if (!g || !st) continue;
      const active = anySolo ? st.solo : !st.muted;
      g.gain.value = active ? st.volume : 0;
    }
  }, [tracks, trackStates, anySolo]);

  // ── master ──────────────────────────────────────────────────
  useEffect(() => {
    mixGraph().master.gain.value = master.muted ? 0 : master.volume;
  }, [master]);

  // ── 播放进度 rAF ────────────────────────────────────────────
  useEffect(() => {
    if (!playing) { cancelTick(); return; }
    const ctx = audioContext();
    const dur = safeDur(duration);
    const tick = () => {
      const t = ctx.currentTime - startedAtRef.current + startedFromRef.current;
      if (Number.isFinite(t)) {
        if (dur > 0 && t >= dur) {
          stopAllTracks();
          startedFromRef.current = dur;
          setTime(dur);
          setPlaying(false);
          return;
        }
        setTime(Math.max(0, Math.min(t, dur)));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return cancelTick;
  }, [playing, duration, cancelTick]);

  // ── 传输控制 ────────────────────────────────────────────────
  const play = useCallback(async (from?: number) => {
    if (!tracks.length) return;
    await resumeAudio();
    setLoading(true);
    await waitForDecode(tracks.map((t) => t.name));
    setLoading(false);

    const ctx = audioContext();
    const dur = safeDur(
      tracks.reduce((a, t) => Math.max(a, trackDuration(t.name)), duration),
    );
    if (dur > 0) setDuration(dur);

    let offset = safeTime(from ?? time, dur);
    if (dur > 0 && offset >= dur) offset = 0;   // 末尾点播放 → 回到起点

    const when = ctx.currentTime + LOOKAHEAD;
    startedAtRef.current = when;
    startedFromRef.current = offset;
    setTime(offset);

    stopAllTracks();
    for (const t of tracks) startTrack(t.name, when, offset);
    setPlaying(true);
  }, [tracks, time, duration]);

  const pause = useCallback(() => {
    if (!playing) return;
    cancelTick();                                       // 同步消灭可能覆盖 time 的下一帧
    const cur = startedFromRef.current
      + Math.max(0, audioContext().currentTime - startedAtRef.current);
    stopAllTracks();
    const clamped = Math.max(0, Math.min(cur, safeDur(duration)));
    startedFromRef.current = clamped;
    setTime(clamped);
    setPlaying(false);
  }, [playing, duration, cancelTick]);

  const seek = useCallback((t: number) => {
    const dur = safeDur(duration);
    const clamped = safeTime(t, dur);
    if (playing) {
      const ctx = audioContext();
      const when = ctx.currentTime + LOOKAHEAD;
      stopAllTracks();
      for (const tr of tracks) startTrack(tr.name, when, clamped);
      startedAtRef.current = when;
    }
    startedFromRef.current = clamped;
    setTime(clamped);                  // 进入新区间，rAF 会自然从这里继续推进
  }, [duration, playing, tracks]);

  const toggle = useCallback(() => {
    if (playing) pause(); else void play();
  }, [playing, pause, play]);

  // ── 通道控制 ────────────────────────────────────────────────
  const patchTrack = useCallback((name: string, patch: Partial<TrackState>) => {
    setTrackStates((s) => ({ ...s, [name]: { ...(s[name] ?? DEFAULT_STATE), ...patch } }));
  }, []);

  const setVolume     = useCallback((n: string, v: number) => patchTrack(n, { volume: v }), [patchTrack]);
  const toggleMute    = useCallback((n: string) =>
    setTrackStates((s) => ({ ...s, [n]: { ...(s[n] ?? DEFAULT_STATE), muted: !(s[n] ?? DEFAULT_STATE).muted } })), []);
  const toggleSolo    = useCallback((n: string) =>
    setTrackStates((s) => ({ ...s, [n]: { ...(s[n] ?? DEFAULT_STATE), solo:  !(s[n] ?? DEFAULT_STATE).solo  } })), []);
  const setMaster         = useCallback((v: number) => setMasterState((m) => ({ ...m, volume: v })), []);
  const toggleMasterMute  = useCallback(() => setMasterState((m) => ({ ...m, muted: !m.muted })), []);
  const getAnalyser       = useCallback((name: string) => trackAnalyser(name), []);

  // 卸载兜底
  useEffect(() => () => stopAllTracks(), []);

  return {
    tracks, trackStates, master, time, duration, playing, loading,
    play, pause, toggle, seek,
    setVolume, toggleMute, toggleSolo, setMaster, toggleMasterMute,
    getAnalyser,
  };
}

// ─── Provider + Context ───────────────────────────────────────────
const MixerCtx = createContext<MixerApi | null>(null);

export function MixerProvider({
  tracks, children,
}: { tracks: MixerTrackInput[]; children: ReactNode }) {
  const api = useMixerImpl(tracks);
  return <MixerCtx.Provider value={api}>{children}</MixerCtx.Provider>;
}

export function useMixer(): MixerApi {
  const v = useContext(MixerCtx);
  if (!v) throw new Error("useMixer must be used inside <MixerProvider>");
  return v;
}

/** 容忍性版本：不在 Provider 内时返回 null（用于跨 Tab 的可选消费者） */
export function useMixerOptional(): MixerApi | null {
  return useContext(MixerCtx);
}
