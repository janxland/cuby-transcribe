/**
 * 力度（velocity）泳道：每个音符一根柱子；竖向拖动调整选中音符的力度。
 * 与上方画布共享 `pxPerSec`，sticky 在底部。
 */
import { useRef } from "react";
import { timeToX } from "./geometry";
import type { EditorViewport } from "./types";
import type { ScoreEditorApi } from "./useScoreEditor";

const LANE_H = 88;

export function VelocityLane({
  api, viewport, duration,
}: {
  api: ScoreEditorApi;
  viewport: EditorViewport;
  duration: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ ids: string[] } | null>(null);
  const width = Math.max(800, timeToX(duration + 1, viewport));

  const applyByY = (clientY: number) => {
    const svg = ref.current!;
    const rect = svg.getBoundingClientRect();
    const y = Math.max(0, Math.min(LANE_H, clientY - rect.top));
    const v = Math.round(((LANE_H - y) / LANE_H) * 127);
    const ids = dragRef.current?.ids ?? [];
    api.patchIds(ids, (n) => ({ ...n, velocity: Math.max(1, Math.min(127, v)) }));
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!api.selection.has(id)) api.select([id], "replace");
    api.pushHistory();
    dragRef.current = { ids: api.selection.has(id) && api.selection.size > 1 ? [...api.selection] : [id] };
    applyByY(e.clientY);
  };

  const onMove = (e: React.PointerEvent) => { if (dragRef.current) applyByY(e.clientY); };
  const onUp = () => { dragRef.current = null; };

  return (
    <div className="border-t border-slate-800 bg-slate-950/60">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">力度</div>
      <svg
        ref={ref}
        width={width}
        height={LANE_H}
        style={{ display: "block", touchAction: "none" }}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {/* 三档参考线 */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={0} y1={LANE_H * r} x2={width} y2={LANE_H * r}
            stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
        ))}
        {api.notes.map((n) => {
          const x = timeToX(n.time, viewport);
          const h = (n.velocity / 127) * LANE_H;
          const selected = api.selection.has(n.id);
          return (
            <rect
              key={n.id}
              x={x}
              y={LANE_H - h}
              width={3}
              height={h}
              fill={selected ? "#fbbf24" : "#6366f1"}
              opacity={selected ? 1 : 0.7}
              onPointerDown={(e) => onPointerDown(e, n.id)}
              style={{ cursor: "ns-resize" }}
            />
          );
        })}
      </svg>
    </div>
  );
}
