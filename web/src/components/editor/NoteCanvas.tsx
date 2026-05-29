/**
 * 交互式音符画布（SVG）—— 编辑器中唯一与指针打交道的组件。
 *
 * 工具语义（精简到一个心智模型）：
 *   - select：点击空白 = 取消选择；点击音符 = 选中（Shift 多选）；拖音符 = 移动；拖右侧 8px = 改长度
 *   - draw  ：点击空白 = 落下 1-grid 长的新音符并继续右拖延长；点击音符 = 同 select
 *   - erase ：点击音符 = 删除
 *
 * 一次完整指针操作（down → move* → up）== 一次撤销单元：
 *   - down 时 `pushHistory()` 一次；
 *   - move 期间任意频次的 `patchIds` 不再入栈；
 *   - up 后即可 `undo` 整段。
 */
import { useEffect, useMemo, useRef } from "react";
import type { EditorNote, EditorViewport, GridConfig, Tool } from "./types";
import {
  clampPitch, gridStep, hitTest, isWhiteKey, pitchToY, snapTime,
  timeToX, xToTime, yToPitch,
} from "./geometry";
import type { ScoreEditorApi } from "./useScoreEditor";

interface Props {
  api: ScoreEditorApi;
  viewport: EditorViewport;
  grid: GridConfig;
  bpm: number;
  tool: Tool;
  duration: number;       // 谱面总时长（秒，用于画网格 / 容器宽）
  playheadTime?: number;
  onAuditionNote?: (pitch: number, velocity: number) => void;
}

type Interaction =
  | { kind: "move"; startX: number; startY: number; origs: Map<string, EditorNote> }
  | { kind: "resize"; startX: number; origs: Map<string, EditorNote> }
  | { kind: "create"; id: string; anchorTime: number };

export function NoteCanvas({
  api, viewport, grid, bpm, tool, duration, playheadTime, onAuditionNote,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const interactionRef = useRef<Interaction | null>(null);

  const width = Math.max(800, timeToX(duration + 1, viewport));
  const height = (viewport.pitchMax - viewport.pitchMin + 1) * viewport.rowH;
  const step = gridStep(bpm, grid);

  // 行背景（白/黑键带）
  const rows = useMemo(() => {
    const out: { pitch: number; y: number; white: boolean }[] = [];
    for (let p = viewport.pitchMax; p >= viewport.pitchMin; p--) {
      out.push({ pitch: p, y: pitchToY(p, viewport), white: isWhiteKey(p) });
    }
    return out;
  }, [viewport]);

  // 网格竖线
  const gridLines = useMemo(() => {
    const out: { x: number; strong: boolean }[] = [];
    const beat = 60 / bpm;
    const totalBeats = Math.ceil(duration / beat) + 4;
    const sub = grid.division / 4; // 每拍的细线数
    for (let b = 0; b <= totalBeats; b++) {
      for (let s = 0; s < sub; s++) {
        const t = b * beat + (s * beat) / sub;
        out.push({ x: timeToX(t, viewport), strong: s === 0 });
      }
    }
    return out;
  }, [bpm, duration, grid.division, viewport]);

  // ── 坐标转换：clientX/Y → 画布 local x/y ────────────────────
  const localXY = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // ── 指针按下：分发到三种工具 + 命中测试 ──────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = localXY(e);
    const hit = hitTest(x, y, api.notes, viewport);
    const shift = e.shiftKey;

    if (tool === "erase") {
      if (hit) {
        api.pushHistory();
        api.deleteIds([hit.id]);
      }
      return;
    }

    if (hit) {
      // 命中音符 —— select / draw 行为相同
      if (shift) {
        api.select([hit.id], "toggle");
        return;
      }
      if (!api.selection.has(hit.id)) api.select([hit.id], "replace");

      const note = api.notes.find((n) => n.id === hit.id)!;
      onAuditionNote?.(note.pitch, note.velocity);
      api.pushHistory();
      const targets = api.selection.has(hit.id) && api.selection.size > 1
        ? [...api.selection]
        : [hit.id];
      const origs = new Map(api.notes.filter((n) => targets.includes(n.id)).map((n) => [n.id, { ...n }]));
      interactionRef.current = hit.zone === "right"
        ? { kind: "resize", startX: x, origs }
        : { kind: "move", startX: x, startY: y, origs };
      return;
    }

    // 空白
    api.clearSelection();
    if (tool === "draw") {
      const pitch = clampPitch(yToPitch(y, viewport), viewport);
      const t0 = snapTime(xToTime(x, viewport), bpm, grid);
      api.pushHistory();
      const id = api.addNote({ pitch, time: t0, duration: step, velocity: 90 });
      onAuditionNote?.(pitch, 90);
      interactionRef.current = { kind: "create", id, anchorTime: t0 };
    }
  };

  // ── 指针移动：根据 interaction 类型派发 patch（不再 pushHistory） ──
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      const [x, y] = localXY(e);

      if (it.kind === "move") {
        const dxTime = xToTime(x - it.startX, viewport);
        const dyRow = Math.round((y - it.startY) / viewport.rowH);
        api.patchIds(it.origs.keys(), (n) => {
          const o = it.origs.get(n.id)!;
          return {
            ...n,
            time: snapTime(Math.max(0, o.time + dxTime), bpm, grid),
            pitch: clampPitch(o.pitch - dyRow, viewport),
          };
        });
      } else if (it.kind === "resize") {
        const dxTime = xToTime(x - it.startX, viewport);
        api.patchIds(it.origs.keys(), (n) => {
          const o = it.origs.get(n.id)!;
          const endRaw = Math.max(o.time + 0.02, o.time + o.duration + dxTime);
          const end = snapTime(endRaw, bpm, grid);
          return { ...n, duration: Math.max(0.02, end - o.time) };
        });
      } else if (it.kind === "create") {
        const tCur = snapTime(xToTime(x, viewport), bpm, grid);
        const t1 = Math.max(it.anchorTime + step, tCur + step);
        api.patchIds([it.id], (n) => ({ ...n, duration: t1 - it.anchorTime }));
      }
    };
    const onUp = () => { interactionRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [api, viewport, bpm, grid, step]);

  // 删除快捷键 —— 仅在 svg 处于 focus / 容器内时拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && api.selection.size) {
        e.preventDefault();
        api.pushHistory();
        api.deleteIds(api.selection);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        api.selectAll();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        api.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        api.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const cursor = tool === "erase" ? "cell" : tool === "draw" ? "crosshair" : "default";

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
      style={{ display: "block", cursor, touchAction: "none" }}
    >
      {/* 行背景 */}
      {rows.map((r) => (
        <rect
          key={r.pitch}
          x={0}
          y={r.y}
          width={width}
          height={viewport.rowH}
          fill={r.white ? "rgba(30,41,59,0.45)" : "rgba(15,23,42,0.7)"}
        />
      ))}
      {/* C 横线 */}
      {rows.filter((r) => r.pitch % 12 === 0).map((r) => (
        <line
          key={`c${r.pitch}`}
          x1={0}
          y1={r.y}
          x2={width}
          y2={r.y}
          stroke="rgba(148,163,184,0.18)"
          strokeWidth={1}
        />
      ))}
      {/* 网格 */}
      {gridLines.map((g, i) => (
        <line
          key={i}
          x1={g.x}
          y1={0}
          x2={g.x}
          y2={height}
          stroke={g.strong ? "rgba(148,163,184,0.30)" : "rgba(148,163,184,0.10)"}
          strokeWidth={1}
        />
      ))}
      {/* 音符 */}
      {api.notes.map((n) => {
        const selected = api.selection.has(n.id);
        const x = timeToX(n.time, viewport);
        const w = Math.max(3, timeToX(n.duration, viewport));
        const y = pitchToY(n.pitch, viewport);
        const op = 0.55 + (n.velocity / 127) * 0.45;
        return (
          <g key={n.id}>
            <rect
              x={x}
              y={y + 1}
              width={w}
              height={viewport.rowH - 2}
              rx={3}
              fill={selected ? "#fbbf24" : "#6366f1"}
              opacity={op}
              stroke={selected ? "#fde68a" : "rgba(255,255,255,0.15)"}
              strokeWidth={selected ? 1.5 : 0.5}
            />
            {/* 右侧 resize 把手提示（仅 select 时显示，避免视觉噪声） */}
            {selected && w > 12 && (
              <rect
                x={x + w - 4}
                y={y + 2}
                width={3}
                height={viewport.rowH - 4}
                fill="rgba(255,255,255,0.4)"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
      {/* 播放头 */}
      {playheadTime !== undefined && playheadTime >= 0 && (
        <line
          x1={timeToX(playheadTime, viewport)}
          y1={0}
          x2={timeToX(playheadTime, viewport)}
          y2={height}
          stroke="#f43f5e"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
