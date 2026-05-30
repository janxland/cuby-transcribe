/**
 * 谱子编辑器根组件
 *
 * 数据流（单向、无副作用回环）：
 *   store.scores[stem]  ─初值─▶ useScoreEditor (本地 working copy + 历史栈)
 *                                       │
 *                                       └─ onChange ──▶ store.updateScoreNotes(stem, notes)
 *
 *  - 切换编辑的 stem：以 `key={editingStem}` 强制重挂 hook，自然得到全新历史栈，避免双向同步。
 *  - 播放头：来自全局 mixer（与 Sky15 / StemsPanel 共享同一时钟）。
 *  - 试听：与 Sky15 共用 `synth.ts`，被编辑音符所属 stem 的音色暂未细分，统一回退到 "piano"。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStoreShallow } from "@/selectors";
import { stemMeta } from "@/stems";
import { useMixerOptional } from "../mixer";
import { Transport } from "../mixer/Transport";
import { playNote } from "../synth";
import { EditorToolbar } from "./EditorToolbar";
import { NoteCanvas } from "./NoteCanvas";
import { PianoSidebar } from "./PianoSidebar";
import { VelocityLane } from "./VelocityLane";
import { fromScoreNotes } from "./types";
import type { EditorViewport, GridConfig, Tool } from "./types";
import { useScoreEditor } from "./useScoreEditor";

const DEFAULT_VIEWPORT: EditorViewport = {
  pxPerSec: 120,
  rowH: 16,
  pitchMin: 36, // C2
  pitchMax: 96, // C7
};

export function ScoreEditor() {
  const { scores, activeStems } = useStoreShallow((s) => ({ scores: s.scores, activeStems: s.activeStems }));
  const stemKeys = Object.keys(scores);

  // 编辑哪一份 —— 默认主显；切换由 toolbar 控制；外层切 activeStems 时若当前消失则回落到主显
  const [editingStem, setEditingStem] = useState<string>(() => activeStems[0] ?? stemKeys[0] ?? "");
  const effectiveStem = scores[editingStem] ? editingStem : (activeStems[0] ?? stemKeys[0] ?? "");

  if (!effectiveStem) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        还没有可编辑的谱子，先在「音轨混音」生成一份吧
      </div>
    );
  }

  // 以 stem 为 key 强制重挂，得到全新历史栈 / 工作副本
  return (
    <EditorBody
      key={effectiveStem}
      editingStem={effectiveStem}
      stems={stemKeys}
      onEditingStemChange={setEditingStem}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// 真正干活的子组件 —— 与 stem 绑死，避免初值/历史栈跨 stem 串味
// ─────────────────────────────────────────────────────────────
function EditorBody({
  editingStem, stems, onEditingStemChange,
}: {
  editingStem: string;
  stems: string[];
  onEditingStemChange: (s: string) => void;
}) {
  const { scores, updateScoreNotes } = useStoreShallow((s) => ({ scores: s.scores, updateScoreNotes: s.updateScoreNotes }));
  const mixer = useMixerOptional();
  const entry = scores[editingStem];
  const bpm = entry.meta.bpm || 120;

  // 视口（缩放） + 工具 + 网格
  const [viewport, setViewport] = useState<EditorViewport>(DEFAULT_VIEWPORT);
  const [tool, setTool] = useState<Tool>("select");
  const [grid, setGrid] = useState<GridConfig>({ division: 16, snap: true });

  // ── 编辑器状态机 ─────────────────────────────────────────
  const initialNotes = useMemo(() => fromScoreNotes(entry.score.tracks[0]?.notes ?? []), [entry]);
  const writeBack = useCallback(
    (notes: Parameters<typeof updateScoreNotes>[1]) => updateScoreNotes(editingStem, notes),
    [editingStem, updateScoreNotes],
  );
  const api = useScoreEditor(initialNotes, writeBack);

  // ── 试听音色：取所属 stem 的偏好；编辑器场景统一回退 piano ───
  const audition = useCallback((pitch: number, _velocity = 90) => {
    void playNote("piano", pitch);
  }, []);

  // ── 视口缩放 ─────────────────────────────────────────────
  const onZoomH = (d: number) =>
    setViewport((v) => ({ ...v, pxPerSec: Math.max(40, Math.min(600, v.pxPerSec * (d > 0 ? 1.25 : 0.8))) }));
  const onZoomV = (d: number) =>
    setViewport((v) => ({ ...v, rowH: Math.max(10, Math.min(28, v.rowH + (d > 0 ? 2 : -2))) }));

  // ── 时长 / 滚动跟随 ──────────────────────────────────────
  const duration = useMemo(
    () => api.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0),
    [api.notes],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // 自动滚动到播放头边缘
  const playhead = mixer?.time ?? 0;
  useScrollFollow(scrollRef, playhead * viewport.pxPerSec);

  // 工具栏数据
  const stemItems = stems.map((id) => {
    const m = stemMeta(id);
    return { id, label: m.label, icon: m.icon };
  });

  return (
    <div className="h-full flex flex-col bg-slate-950/40">
      {mixer && <Transport bpm={bpm} />}
      <EditorToolbar
        tool={tool} onToolChange={setTool}
        grid={grid} onGridChange={setGrid}
        pxPerSec={viewport.pxPerSec} rowH={viewport.rowH}
        onZoomH={onZoomH} onZoomV={onZoomV}
        canUndo={api.canUndo} canRedo={api.canRedo}
        onUndo={api.undo} onRedo={api.redo}
        selectionCount={api.selection.size}
        onDeleteSelected={() => { api.pushHistory(); api.deleteIds(api.selection); }}
        onAuditionSelected={() => {
          const selected = api.notes.filter((n) => api.selection.has(n.id));
          selected.forEach((n, i) => window.setTimeout(() => audition(n.pitch, n.velocity), i * 60));
        }}
        stems={stemItems}
        editingStem={editingStem}
        onEditingStemChange={onEditingStemChange}
      />
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto relative">
        <div className="flex" style={{ minWidth: "100%" }}>
          <PianoSidebar viewport={viewport} onAuditionPitch={audition} />
          <div className="flex-1">
            <NoteCanvas
              api={api}
              viewport={viewport}
              grid={grid}
              bpm={bpm}
              tool={tool}
              duration={duration}
              playheadTime={mixer ? playhead : undefined}
              onAuditionNote={audition}
            />
            <VelocityLane api={api} viewport={viewport} duration={duration} />
          </div>
        </div>
      </div>
    </div>
  );
}

// 自动横向滚动跟随播放头（保留 20% 边距）
function useScrollFollow(
  ref: React.RefObject<HTMLDivElement | null>,
  x: number,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft;
    const right = left + el.clientWidth - 56; // 减去侧栏宽度
    if (x < left + 40 || x > right - 80) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2);
    }
  }, [ref, x]);
}
