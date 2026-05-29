import { useMemo, useRef, useState } from "react";
import { useMixer } from "./useMixer";
import { fmt, pct, safeDur } from "./utils";

const HEADER_WIDTH = 240;
const MAX_TICKS = 240;

/** 顶部时间标尺 + 共享播放头；同时挂着鼠标 hover 提示时间 */
export function Ruler() {
  const m = useMixer();
  const ref = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const dragging = useRef(false);

  const dur = safeDur(m.duration);

  const ticks = useMemo(() => computeTicks(dur), [dur]);

  const calc = (clientX: number) => {
    const el = ref.current; if (!el || dur <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return { x, t: (x / rect.width) * dur };
  };

  return (
    <div className="flex border-b border-slate-800 bg-slate-950/60 select-none">
      <div
        style={{ width: HEADER_WIDTH }}
        className="shrink-0 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-r border-slate-800 flex items-center"
      >
        Tracks
      </div>
      <div
        ref={ref}
        className="relative flex-1 h-9 cursor-text"
        onMouseDown={(e) => { dragging.current = true; const r = calc(e.clientX); if (r) m.seek(r.t); }}
        onMouseMove={(e) => {
          const r = calc(e.clientX);
          if (!r) return;
          setHoverPct((r.x / (ref.current?.getBoundingClientRect().width ?? 1)) * 100);
          if (dragging.current) m.seek(r.t);
        }}
        onMouseLeave={() => { dragging.current = false; setHoverPct(null); }}
        onMouseUp={() => { dragging.current = false; }}
      >
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute top-0 bottom-0 border-l border-slate-800"
            style={{ left: `${pct(t, dur)}%` }}
          >
            <span className="absolute top-1 left-1 text-[10px] text-slate-500 tabular-nums">
              {fmt(t, false)}
            </span>
          </div>
        ))}

        {/* hover guideline */}
        {hoverPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-slate-500/60 pointer-events-none"
            style={{ left: `${hoverPct}%` }}
          />
        )}

        {/* 播放头 */}
        <div
          className="absolute top-0 bottom-0 w-px bg-indigo-400 pointer-events-none shadow-[0_0_4px_rgba(129,140,248,0.8)]"
          style={{ left: `${pct(m.time, dur)}%` }}
        />
      </div>
    </div>
  );
}

/** 根据时长计算标尺刻度，强制上限 240 个，永远返回有限数组 */
function computeTicks(dur: number): number[] {
  if (dur <= 0) return [];
  let step = dur <= 10 ? 1 : dur <= 30 ? 2 : dur <= 60 ? 5 : dur <= 180 ? 10 : 30;
  while (Math.floor(dur / step) > MAX_TICKS) step *= 2;
  const n = Math.min(MAX_TICKS, Math.floor(dur / step) + 1);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = i * step;
  return out;
}

export { HEADER_WIDTH };
