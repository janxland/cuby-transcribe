/**
 * 专业级混音引擎（Web Audio）
 *
 *  - 采样级对齐：所有 BufferSource 用同一 `ctx.currentTime + LOOKAHEAD` 启动
 *  - master limiter 防止多轨求和削波
 *  - AudioBuffer / 峰值共享同一份 fetch 缓存
 *  - 纯模块、零 React 依赖
 */

// ─── AudioContext 单例 ────────────────────────────────────────────
let _ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!_ctx) {
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    _ctx = new Ctor({ latencyHint: "interactive" });
  }
  return _ctx;
}
export async function resumeAudio(): Promise<void> {
  const ctx = audioContext();
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* noop */ }
  }
}

// ─── 解码 + 峰值缓存（共用同一 fetch） ────────────────────────────
const decodeCache = new Map<string, Promise<AudioBuffer>>();
export function decodeAudio(url: string): Promise<AudioBuffer> {
  let hit = decodeCache.get(url);
  if (hit) return hit;
  hit = (async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    return audioContext().decodeAudioData(await r.arrayBuffer());
  })();
  decodeCache.set(url, hit);
  hit.catch(() => decodeCache.delete(url));
  return hit;
}

const peakCache = new Map<string, Promise<Float32Array>>();
/** 长度 = buckets*2 的 Float32：[min0,max0, min1,max1, ...] */
export function getPeaks(url: string, buckets = 600): Promise<Float32Array> {
  const key = `${url}#${buckets}`;
  let hit = peakCache.get(key);
  if (hit) return hit;
  hit = decodeAudio(url).then((audio) => computePeaks(audio.getChannelData(0), buckets));
  peakCache.set(key, hit);
  hit.catch(() => peakCache.delete(key));
  return hit;
}

function computePeaks(ch: Float32Array, buckets: number): Float32Array {
  const step = Math.max(1, Math.floor(ch.length / buckets));
  const out = new Float32Array(buckets * 2);
  for (let i = 0; i < buckets; i++) {
    const start = i * step;
    const end = Math.min(ch.length, start + step);
    let mn = 1.0, mx = -1.0;
    for (let j = start; j < end; j++) {
      const v = ch[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[i * 2] = mn;
    out[i * 2 + 1] = mx;
  }
  return out;
}

// ─── 音频图 + 每轨引擎 ────────────────────────────────────────────
export interface TrackEngine {
  url: string;
  buffer: AudioBuffer | null;
  decoding: Promise<AudioBuffer>;
  gain: GainNode;
  analyser: AnalyserNode;
  current: AudioBufferSourceNode | null;
}

export interface MixGraph {
  master: GainNode;
  masterAnalyser: AnalyserNode;
  tracks: Map<string, TrackEngine>;
}

let _graph: MixGraph | null = null;
export function mixGraph(): MixGraph {
  if (_graph) return _graph;
  const ctx = audioContext();

  const master = ctx.createGain();
  master.gain.value = 0.8;

  // 多轨求和后的硬限制器
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  const masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = 1024;

  master.connect(limiter);
  limiter.connect(masterAnalyser);
  masterAnalyser.connect(ctx.destination);

  _graph = { master, masterAnalyser, tracks: new Map() };
  return _graph;
}

// 单一销毁路径，避免 ensureTrack 内重复 try/disconnect 代码
function disposeEngine(e: TrackEngine) {
  if (e.current) {
    try { (e.current as any).__manualStop?.(); } catch { /* noop */ }
    try { e.current.stop(); } catch { /* noop */ }
    try { e.current.disconnect(); } catch { /* noop */ }
    e.current = null;
  }
  try { e.gain.disconnect(); } catch { /* noop */ }
  try { e.analyser.disconnect(); } catch { /* noop */ }
}

/** 注册一条音轨（幂等）。会启动后台解码。 */
export function ensureTrack(name: string, url: string, defaultVolume = 0.85): TrackEngine {
  const g = mixGraph();
  const cached = g.tracks.get(name);
  if (cached && cached.url === url) return cached;
  if (cached) { disposeEngine(cached); g.tracks.delete(name); }

  const ctx = audioContext();
  const gain = ctx.createGain();
  gain.gain.value = defaultVolume;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  gain.connect(analyser);
  analyser.connect(g.master);

  const engine: TrackEngine = {
    url, gain, analyser, current: null,
    buffer: null,
    decoding: decodeAudio(url).then((b) => { engine.buffer = b; return b; }),
  };
  g.tracks.set(name, engine);
  return engine;
}

export async function waitForDecode(names: string[]): Promise<void> {
  const g = mixGraph();
  await Promise.all(
    names
      .map((n) => g.tracks.get(n)?.decoding)
      .filter((p): p is Promise<AudioBuffer> => !!p)
      .map((p) => p.catch(() => undefined)),
  );
}

export function startTrack(name: string, when: number, offset: number): AudioBufferSourceNode | null {
  const g = mixGraph();
  const e = g.tracks.get(name);
  if (!e || !e.buffer) return null;
  stopTrack(name);

  const src = audioContext().createBufferSource();
  src.buffer = e.buffer;
  src.connect(e.gain);
  (src as any).__manualStop = () => { (src as any).__stopped = true; };
  src.start(when, Math.max(0, Math.min(offset, e.buffer.duration)));
  e.current = src;
  return src;
}

export function stopTrack(name: string): void {
  const e = mixGraph().tracks.get(name);
  if (!e || !e.current) return;
  try { (e.current as any).__manualStop?.(); } catch { /* noop */ }
  try { e.current.stop(); } catch { /* noop */ }
  try { e.current.disconnect(); } catch { /* noop */ }
  e.current = null;
}

export function stopAllTracks(): void {
  for (const name of mixGraph().tracks.keys()) stopTrack(name);
}

export function trackAnalyser(name: string): AnalyserNode | null {
  return mixGraph().tracks.get(name)?.analyser ?? null;
}
export function trackGain(name: string): GainNode | null {
  return mixGraph().tracks.get(name)?.gain ?? null;
}
export function trackDuration(name: string): number {
  return mixGraph().tracks.get(name)?.buffer?.duration ?? 0;
}
