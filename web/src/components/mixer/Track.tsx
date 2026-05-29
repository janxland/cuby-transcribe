/**
 * 一条音轨：ChannelStrip（左）+ Lane（右）
 * 所有子模块通过 useMixer() 拿状态，无需 props 透传。
 */
import { useEffect, useRef, useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { useMixer } from "./useMixer";
import { stemMeta } from "../../stems";
import { gainToDb, fmt, pct, safeDur, waveColor } from "./utils";
import { getPeaks } from "./audio";

interface Props {
  name: string;
  url: string;
  /** 当前以此 stem 为扒谱目标，UI 高亮 */
  active: boolean;
  /** 重扒按钮回调；为 undefined 则不显示该按钮 */
  onRetranscribe?: () => void;
  /** 操作是否被禁用（任务进行中） */
  disabled?: boolean;
}

export function Track({ name, url, active, onRetranscribe, disabled }: Props) {
  return (
    <div className={["flex items-stretch hover:bg-slate-900/40", active ? "bg-amber-400/5" : ""].join(" ")}>
      <ChannelStrip name={name} active={active} onRetranscribe={onRetranscribe} disabled={!!disabled} url={url} />
      <Lane name={name} url={url} active={active} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 左：Channel Strip — 颜色条 + 头部信息 + 操作按钮 + M/S + 推子 + 电平
// ─────────────────────────────────────────────────────────────
const STRIP_WIDTH = 240;

function ChannelStrip({
  name, active, onRetranscribe, disabled, url,
}: { name: string; active: boolean; onRetranscribe?: () => void; disabled: boolean; url: string }) {
  const m = useMixer();
  const meta = stemMeta(name);
  const st = m.trackStates[name] ?? { volume: 0.9, muted: false, solo: false };
  const isSilent = (() => {
    const anySolo = Object.values(m.trackStates).some((x) => x.solo);
    return anySolo ? !st.solo : st.muted;
  })();

  return (
    <div style={{ width: STRIP_WIDTH }} className="shrink-0 flex border-r border-slate-800">
      {/* 颜色条 + 播放指示 */}
      <div className={`w-1.5 bg-gradient-to-b ${meta.color} relative`}>
        {m.playing && !isSilent && (
          <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        )}
      </div>

      <div className="flex-1 p-2 min-w-0 flex flex-col gap-1.5">
        {/* 标题行 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base leading-none">{meta.icon}</span>
          <span className="text-sm font-medium truncate flex-1" title={meta.label}>{meta.label}</span>
          {active && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-400 text-slate-900 font-bold leading-none">扒</span>
          )}
          {/* 常驻操作按钮 */}
          <a
            href={url}
            download={`${name}.wav`}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            title="下载本轨 WAV"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
          {!active && onRetranscribe && (
            <button
              disabled={disabled}
              onClick={onRetranscribe}
              title="用这条音轨重新扒谱"
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* M / S */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => m.toggleMute(name)}
            title={st.muted ? "取消静音" : "静音"}
            className={[
              "w-6 h-5 rounded text-[10px] font-bold flex items-center justify-center transition",
              st.muted ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
            ].join(" ")}
          >
            M
          </button>
          <button
            onClick={() => m.toggleSolo(name)}
            title={st.solo ? "取消独奏" : "仅听本轨"}
            className={[
              "w-6 h-5 rounded text-[10px] font-bold flex items-center justify-center transition",
              st.solo ? "bg-yellow-400 text-slate-900" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
            ].join(" ")}
          >
            S
          </button>
          <span className="ml-auto text-[10px] tabular-nums text-slate-500 w-10 text-right">
            {gainToDb(st.volume)} dB
          </span>
        </div>

        {/* 推子 */}
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={st.volume}
          onChange={(e) => m.setVolume(name, Number(e.target.value))}
          onDoubleClick={() => m.setVolume(name, 0.9)}
          className="w-full accent-indigo-400 h-1"
          title="拖动调节音量；双击重置"
        />

        {/* 电平表 */}
        <LevelMeter name={name} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 电平表（基于 AnalyserNode 的 RMS）
// ─────────────────────────────────────────────────────────────
function LevelMeter({ name }: { name: string }) {
  const m = useMixer();
  const [level, setLevel] = useState(0);
  const buf = useRef<Uint8Array | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const loop = () => {
      const an = m.getAnalyser(name);
      if (an) {
        if (!buf.current || buf.current.length !== an.fftSize) {
          buf.current = new Uint8Array(an.fftSize);
        }
        an.getByteTimeDomainData(buf.current);
        let sum = 0;
        for (let i = 0; i < buf.current.length; i++) {
          const v = (buf.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.current.length);
        setLevel((p) => Math.max(rms, p * 0.85));
      } else {
        setLevel((p) => p * 0.85);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [m, name]);

  const pctVal = Math.min(100, level * 180);
  return (
    <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
      <div
        className="h-full transition-[width] duration-75"
        style={{
          width: `${pctVal}%`,
          background: "linear-gradient(90deg,#22c55e 0%,#22c55e 60%,#facc15 75%,#ef4444 100%)",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 右：Lane — 波形 + 播放头 + 点击/拖动 seek + hover 提示时间
// ─────────────────────────────────────────────────────────────
function Lane({ name, url, active }: { name: string; url: string; active: boolean }) {
  const m = useMixer();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const dragging = useRef(false);

  const dur = safeDur(m.duration);
  const calc = (clientX: number) => {
    const el = ref.current; if (!el || dur <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return { x, t: (x / rect.width) * dur };
  };

  return (
    <div
      ref={ref}
      className="flex-1 relative min-w-0 cursor-crosshair"
      onMouseDown={(e) => { dragging.current = true; const r = calc(e.clientX); if (r) m.seek(r.t); }}
      onMouseMove={(e) => {
        const r = calc(e.clientX);
        if (r) {
          setHover(r);
          if (dragging.current) m.seek(r.t);
        }
      }}
      onMouseLeave={() => { dragging.current = false; setHover(null); }}
      onMouseUp={() => { dragging.current = false; }}
    >
      <Waveform url={url} color={waveColor(name)} highlighted={active} />
      {/* 播放头 */}
      <div
        className="absolute top-0 bottom-0 w-px bg-indigo-400 pointer-events-none shadow-[0_0_4px_rgba(129,140,248,0.8)]"
        style={{ left: `${pct(m.time, dur)}%` }}
      />
      {/* hover 提示 */}
      {hover && (
        <>
          <div
            className="absolute top-0 bottom-0 w-px bg-slate-400/50 pointer-events-none"
            style={{ left: hover.x }}
          />
          <div
            className="absolute -top-0.5 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] tabular-nums text-slate-300 pointer-events-none whitespace-nowrap"
            style={{ left: hover.x + 6 }}
          >
            {fmt(hover.t)}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Canvas 波形
// ─────────────────────────────────────────────────────────────
function Waveform({ url, color, highlighted }: { url: string; color: string; highlighted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [size, setSize] = useState({ w: 0, h: 64 });

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      setSize({ w: e.contentRect.width, h: 64 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPeaks(url, 600)
      .then((p) => { if (!cancelled) setPeaks(p); })
      .catch(() => { /* 波形不可用时降级展示占位 */ });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.floor(size.w * dpr));
    const H = Math.max(1, Math.floor(size.h * dpr));
    c.width = W; c.height = H;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = highlighted ? "rgba(251,191,36,0.06)" : "rgba(15,23,42,0.4)";
    ctx.fillRect(0, 0, W, H);

    const midY = H / 2;

    if (!peaks) {
      ctx.fillStyle = "rgba(148,163,184,0.18)";
      const barW = Math.max(1, Math.floor(2 * dpr));
      for (let x = 0; x < W; x += barW * 2) {
        const h = (Math.sin(x * 0.05) * 0.3 + 0.4) * H * 0.4;
        ctx.fillRect(x, midY - h / 2, barW, h);
      }
      return;
    }

    const buckets = peaks.length / 2;
    ctx.fillStyle = color;
    for (let i = 0; i < buckets; i++) {
      const x = Math.floor((i / buckets) * W);
      const xNext = Math.floor(((i + 1) / buckets) * W);
      const w = Math.max(1, xNext - x - 1);
      const mn = peaks[i * 2];
      const mx = peaks[i * 2 + 1];
      const y1 = midY - mx * midY * 0.95;
      const y2 = midY - mn * midY * 0.95;
      ctx.fillRect(x, y1, w, Math.max(1, y2 - y1));
    }
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, midY - dpr * 0.5, W, dpr);
  }, [peaks, size, color, highlighted]);

  return (
    <div ref={containerRef} className="w-full h-16">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

export { STRIP_WIDTH };
