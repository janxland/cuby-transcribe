/**
 * 左侧钢琴键栏 —— 点击即试听对应音高。
 * 与 NoteCanvas 共用 viewport（rowH / pitch 范围），通过 sticky 跟随横向滚动。
 */
import { isWhiteKey, pitchName, pitchToY } from "./geometry";
import type { EditorViewport } from "./types";

export function PianoSidebar({
  viewport,
  onAuditionPitch,
  highlightPitches,
}: {
  viewport: EditorViewport;
  onAuditionPitch?: (pitch: number) => void;
  /** 当前正在响的音高（用于轻量高亮，可选） */
  highlightPitches?: Set<number>;
}) {
  const items: number[] = [];
  for (let p = viewport.pitchMax; p >= viewport.pitchMin; p--) items.push(p);
  return (
    <div
      className="shrink-0 sticky left-0 z-10 bg-slate-900 border-r border-slate-800"
      style={{ width: 56 }}
    >
      {items.map((p) => {
        const white = isWhiteKey(p);
        const lit = highlightPitches?.has(p);
        return (
          <button
            key={p}
            onMouseDown={(e) => { e.preventDefault(); onAuditionPitch?.(p); }}
            className={[
              "w-full text-[10px] font-mono pr-1 flex items-center justify-end transition",
              white
                ? "bg-slate-100/[0.04] text-slate-300 hover:bg-indigo-500/30"
                : "bg-slate-900 text-slate-500 hover:bg-indigo-500/30",
              lit ? "!bg-amber-400/30 !text-amber-100" : "",
              p % 12 === 0 ? "border-t border-slate-600" : "",
            ].join(" ")}
            style={{
              height: viewport.rowH,
              position: "absolute",
              top: pitchToY(p, viewport),
              left: 0,
              right: 0,
            }}
            title={`试听 ${pitchName(p)}`}
          >
            {pitchName(p)}
          </button>
        );
      })}
      {/* 撑高 */}
      <div style={{ height: (viewport.pitchMax - viewport.pitchMin + 1) * viewport.rowH }} />
    </div>
  );
}
