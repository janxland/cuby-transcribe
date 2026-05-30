import { useEffect, useMemo, useRef } from "react";
import { useStore } from "@/store";
import { usePrimaryScore } from "@/selectors";
import { NATURAL_PCS, PITCH_NAMES } from "@/utils/music";

const PITCH_MIN = 60;
const PITCH_MAX = 84;
const ROWS = PITCH_MAX - PITCH_MIN + 1; // 25

export function PianoRoll() {
  const score = usePrimaryScore();
  const currentTime = useStore((s) => s.currentTime);
  const containerRef = useRef<HTMLDivElement>(null);

  const notes = score?.tracks?.[0]?.notes ?? [];
  const duration = useMemo(() => {
    if (!notes.length) return 1;
    return Math.max(...notes.map((n) => n.time + n.duration)) + 0.5;
  }, [notes]);

  const pxPerSec = 120;
  const rowH = 14;
  const width = Math.max(800, duration * pxPerSec);
  const height = ROWS * rowH;

  // 自动滚动跟随播放头
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const playheadX = currentTime * pxPerSec;
    const visibleStart = el.scrollLeft;
    const visibleEnd = visibleStart + el.clientWidth;
    if (playheadX < visibleStart || playheadX > visibleEnd - 100) {
      el.scrollLeft = Math.max(0, playheadX - el.clientWidth * 0.2);
    }
  }, [currentTime]);

  if (!notes.length) {
    return <Empty text="还没有音符可显示" />;
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex">
        {/* 左侧音名 */}
        <div className="w-12 shrink-0 bg-slate-900 border-r border-slate-800">
          {Array.from({ length: ROWS }, (_, i) => {
            const pitch = PITCH_MAX - i;
            const pc = pitch % 12;
            const isC = pc === 0;
            return (
              <div
                key={pitch}
                className={[
                  "text-[10px] flex items-center justify-end pr-1 font-mono",
                  NATURAL_PCS.has(pc) ? "text-slate-400" : "text-slate-600",
                  isC ? "border-t border-slate-600" : "",
                ].join(" ")}
                style={{ height: rowH }}
              >
                {PITCH_NAMES[pc]}{Math.floor(pitch / 12) - 1}
              </div>
            );
          })}
        </div>

        {/* 卷帘主区 */}
        <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <svg width={width} height={height} className="block">
            {/* 行背景 */}
            {Array.from({ length: ROWS }, (_, i) => {
              const pitch = PITCH_MAX - i;
              const pc = pitch % 12;
              return (
                <rect
                  key={i}
                  x={0}
                  y={i * rowH}
                  width={width}
                  height={rowH}
                  fill={NATURAL_PCS.has(pc) ? "rgba(30,41,59,0.4)" : "rgba(15,23,42,0.6)"}
                />
              );
            })}
            {/* 时间网格 */}
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
              <g key={`t${i}`}>
                <line
                  x1={i * pxPerSec}
                  y1={0}
                  x2={i * pxPerSec}
                  y2={height}
                  stroke="rgba(100,116,139,0.3)"
                  strokeWidth={1}
                />
                <text x={i * pxPerSec + 4} y={12} fill="#64748b" fontSize={10} fontFamily="monospace">
                  {i}s
                </text>
              </g>
            ))}
            {/* 音符 */}
            {notes.map((n, idx) => {
              const row = PITCH_MAX - n.pitch;
              if (row < 0 || row >= ROWS) return null;
              const x = n.time * pxPerSec;
              const w = Math.max(3, n.duration * pxPerSec - 1);
              const active =
                currentTime >= n.time && currentTime < n.time + n.duration;
              return (
                <rect
                  key={idx}
                  x={x}
                  y={row * rowH + 1}
                  width={w}
                  height={rowH - 2}
                  rx={3}
                  fill={active ? "#a78bfa" : "#6366f1"}
                  opacity={active ? 1 : 0.85}
                />
              );
            })}
            {/* 播放头 */}
            <line
              x1={currentTime * pxPerSec}
              y1={0}
              x2={currentTime * pxPerSec}
              y2={height}
              stroke="#f43f5e"
              strokeWidth={2}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
      {text}
    </div>
  );
}
