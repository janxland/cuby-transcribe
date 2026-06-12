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
 *  - 试听：与 Sky15 共用 `synth.ts`，沿用 editor 风格 envelope，并按音符真实时长触发。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStoreShallow } from "@/selectors";
import { stemMeta } from "@/stems";
import { useStore } from "@/store";
import { cleanupScoreWithAi } from "@/api";
import { toAppError } from "@/lib/http";
import { useMixerOptional } from "../mixer";
import { Transport } from "../mixer/Transport";
import { ToneTransport } from "../ToneTransport";
import { playNote } from "../synth";
import { EditorToolbar } from "./EditorToolbar";
import { NoteCanvas } from "./NoteCanvas";
import { PianoSidebar } from "./PianoSidebar";
import { VelocityLane } from "./VelocityLane";
import { fromScoreNotes } from "./types";
import type { EditorViewport, GridConfig, Tool } from "./types";
import { useScoreEditor } from "./useScoreEditor";
import { cleanTrackNotes, splitToTwoTracksByPitch } from "./cleanup";
import type { CleanupStats } from "./cleanup";
import { AssistPanel, type CleanupForm } from "./AssistPanel";
import { toneClock } from "@/utils/toneClock";
import { useToneClockState } from "@/hooks/useToneClock";
import type { ScoreCleanupProvider } from "@/types";

type ScoreSnapshot = {
  tracks: Array<Array<{ pitch: number; time: number; duration: number; velocity: number }>>;
  focusTrackIndex: number;
};

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
  const { scores, updateScoreNotes, replaceScore } = useStoreShallow((s) => ({
    scores: s.scores,
    updateScoreNotes: s.updateScoreNotes,
    replaceScore: s.replaceScore,
  }));
  const mixer = useMixerOptional();
  const entry = scores[editingStem];
  const bpm = entry.meta.bpm || 120;
  const playbackMode = useStore((s) => s.playbackMode);
  const tone = useToneClockState();
  const [editingTrackIndex, setEditingTrackIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const globalPastRef = useRef<ScoreSnapshot[]>([]);
  const globalFutureRef = useRef<ScoreSnapshot[]>([]);
  const [globalHistoryTick, setGlobalHistoryTick] = useState(0);
  const tracks = entry.score.tracks ?? [];
  const safeTrackIndex = Math.max(0, Math.min(editingTrackIndex, Math.max(0, tracks.length - 1)));
  const captureSnapshot = useCallback((focus: number): ScoreSnapshot => ({
    tracks: tracks.map((t) => (t.notes ?? []).map((n) => ({
      pitch: n.pitch,
      time: n.time,
      duration: n.duration,
      velocity: n.velocity,
    }))),
    focusTrackIndex: focus,
  }), [tracks]);

  const applySnapshot = useCallback((snap: ScoreSnapshot, opts?: { pushFutureFrom?: ScoreSnapshot }) => {
    snap.tracks.forEach((notes, idx) => {
      updateScoreNotes(editingStem, notes, idx);
    });
    if (opts?.pushFutureFrom) {
      globalFutureRef.current.push(opts.pushFutureFrom);
    }
    const nextFocus = Math.max(0, Math.min(snap.focusTrackIndex, Math.max(0, snap.tracks.length - 1)));
    setEditingTrackIndex(nextFocus);
    // 当前编辑器状态由 initial/resetKey 驱动自动重置，无需在此直接改本地 api。
    setGlobalHistoryTick((v) => v + 1);
  }, [updateScoreNotes, editingStem]);
  const [cleanupForm, setCleanupForm] = useState<CleanupForm>({
    bpm,
    minDivision: 32,
    pitchMin: 40,
    pitchMax: 90,
    dedupeWindowSec: 0.04,
    mergeGapSec: 0.03,
  });

  useEffect(() => {
    setCleanupForm((prev) => ({ ...prev, bpm }));
  }, [bpm]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isFullscreen]);

  // 视口（缩放） + 工具 + 网格
  const [viewport, setViewport] = useState<EditorViewport>(DEFAULT_VIEWPORT);
  const [tool, setTool] = useState<Tool>("select");
  const [grid, setGrid] = useState<GridConfig>({ division: 16, snap: true });

  // ── 编辑器状态机 ─────────────────────────────────────────
  const initialNotes = useMemo(() => fromScoreNotes(entry.score.tracks[safeTrackIndex]?.notes ?? []), [entry, safeTrackIndex]);
  const writeBack = useCallback(
    (notes: Parameters<typeof updateScoreNotes>[1]) => updateScoreNotes(editingStem, notes, safeTrackIndex),
    [editingStem, safeTrackIndex, updateScoreNotes],
  );
  const api = useScoreEditor(initialNotes, writeBack, `${editingStem}:${safeTrackIndex}`);

  const cleanupCurrentTrack = useCallback((): CleanupStats | null => {
    const cleaned = cleanTrackNotes(api.notes, cleanupForm);
    api.applyOperation({ type: "replace_all", notes: cleaned.notes });
    return cleaned.stats;
  }, [api, cleanupForm]);

  const cleanupAllTracks = useCallback(() => {
    const before = captureSnapshot(safeTrackIndex);
    const cleanedByTrack = tracks.map((t) => {
      const cleaned = cleanTrackNotes(fromScoreNotes(t.notes ?? []), cleanupForm);
      return cleaned;
    });
    const nextTracks = cleanedByTrack.map(({ notes }) => notes.map((n) => ({
        pitch: n.pitch,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      })));
    const after: ScoreSnapshot = { tracks: nextTracks, focusTrackIndex: safeTrackIndex };
    globalPastRef.current.push(before);
    globalFutureRef.current = [];
    applySnapshot(after);
    return cleanedByTrack.map((c) => c.stats);
  }, [tracks, cleanupForm, safeTrackIndex, captureSnapshot, applySnapshot]);

  const applyAiCleanup = useCallback(async (provider: ScoreCleanupProvider) => {
    try {
      const before = captureSnapshot(safeTrackIndex);
      const r = await cleanupScoreWithAi(entry.score, {
        provider,
        removeOneThirtySecondNoise: true,
        minDivision: 32,
        targetBpm: cleanupForm.bpm,
        preserveMelody: true,
      });
      globalPastRef.current.push(before);
      globalFutureRef.current = [];
      replaceScore(editingStem, r.cubyScore, {
        bpm: r.cubyScore.meta.bpm,
        noteCount: r.stats.after,
        tempoSource: "user",
      });
      setGlobalHistoryTick((v) => v + 1);
      return r.stats;
    } catch (e) {
      const err = toAppError(e);
      throw new Error(err.message);
    }
  }, [captureSnapshot, cleanupForm.bpm, editingStem, entry.score, replaceScore, safeTrackIndex]);

  const reduceToTwoTracks = useCallback(() => {
    const before = captureSnapshot(safeTrackIndex);
    const merged = tracks.flatMap((t) => fromScoreNotes(t.notes ?? []));
    const [high, low] = splitToTwoTracksByPitch(merged);
    if (!high.length || !low.length) return;

    const toScore = (notes: ReturnType<typeof fromScoreNotes>) =>
      notes.map((n) => ({
        pitch: n.pitch,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));

    const collapsed = tracks.map((_t, i) => {
      if (i === 0) return toScore(high);
      if (i === 1) return toScore(low);
      return [] as ReturnType<typeof toScore>;
    });
    const after: ScoreSnapshot = {
      tracks: collapsed,
      focusTrackIndex: Math.min(safeTrackIndex, 1),
    };
    globalPastRef.current.push(before);
    globalFutureRef.current = [];
    applySnapshot(after);
  }, [tracks, safeTrackIndex, captureSnapshot, applySnapshot]);

  const transposeTrack = useCallback((semitones: number) => {
    if (!Number.isFinite(semitones) || semitones === 0) return;
    api.applyOperation({
      type: "replace_all",
      notes: api.notes.map((n) => ({
        ...n,
        pitch: Math.max(0, Math.min(127, n.pitch + Math.round(semitones))),
      })),
    });
  }, [api]);

  const stretchTrack = useCallback((factor: number, selectionOnly: boolean) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const safeFactor = Math.max(0.25, Math.min(4, factor));
    const selection = api.selection;
    const target = selectionOnly && selection.size > 0 ? api.notes.filter((n) => selection.has(n.id)) : api.notes;
    if (!target.length) return;
    const anchor = Math.min(...target.map((n) => n.time));
    api.applyOperation({
      type: "replace_all",
      notes: api.notes.map((n) => {
        if (selectionOnly && selection.size > 0 && !selection.has(n.id)) return n;
        return {
          ...n,
          time: Math.max(0, anchor + (n.time - anchor) * safeFactor),
          duration: Math.max(0.01, n.duration * safeFactor),
        };
      }),
    });
  }, [api]);

  const playhead = playbackMode === "midi" ? tone.time : (mixer?.time ?? 0);

  const undo = useCallback(() => {
    const lastGlobal = globalPastRef.current.pop();
    if (lastGlobal) {
      const current = captureSnapshot(safeTrackIndex);
      globalFutureRef.current.push(current);
      applySnapshot(lastGlobal);
      return;
    }
    api.undo();
  }, [api, captureSnapshot, safeTrackIndex, applySnapshot]);

  const redo = useCallback(() => {
    const nextGlobal = globalFutureRef.current.pop();
    if (nextGlobal) {
      const current = captureSnapshot(safeTrackIndex);
      globalPastRef.current.push(current);
      applySnapshot(nextGlobal);
      return;
    }
    api.redo();
  }, [api, captureSnapshot, safeTrackIndex, applySnapshot]);

  const canUndo = globalPastRef.current.length > 0 || api.canUndo;
  const canRedo = globalFutureRef.current.length > 0 || api.canRedo;
  void globalHistoryTick;

  const seekPlayback = useCallback((seconds: number) => {
    const t = Math.max(0, seconds);
    if (playbackMode === "midi") {
      toneClock.seek(t);
    } else {
      mixer?.seek(t);
    }
  }, [playbackMode, mixer]);

  const playFrom = useCallback((seconds: number) => {
    const t = Math.max(0, seconds);
    if (playbackMode === "midi") {
      void toneClock.play(t);
    } else {
      void mixer?.play(t);
    }
  }, [playbackMode, mixer]);

  // ── 试听音色：取所属 stem 的偏好；编辑器场景统一回退 piano ───
  const audition = useCallback((pitch: number, velocity = 90, duration = 0.35) => {
    void playNote("triangle", pitch, duration, velocity);
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
  useScrollFollow(scrollRef, playhead * viewport.pxPerSec);

  // 工具栏数据
  const stemItems = stems.map((id) => {
    const m = stemMeta(id);
    return { id, label: m.label, icon: m.icon };
  });

  return (
    <div className={[
      isFullscreen ? "fixed inset-0 z-[80] h-full flex flex-col bg-slate-950" : "h-full flex flex-col bg-slate-950/40",
    ].join(" ")}>
      {playbackMode === "midi" ? <ToneTransport bpm={bpm} /> : (mixer && <Transport bpm={bpm} />)}
      <EditorToolbar
        tool={tool} onToolChange={setTool}
        grid={grid} onGridChange={setGrid}
        pxPerSec={viewport.pxPerSec} rowH={viewport.rowH}
        onZoomH={onZoomH} onZoomV={onZoomV}
        canUndo={canUndo} canRedo={canRedo}
        onUndo={undo} onRedo={redo}
        selectionCount={api.selection.size}
        onDeleteSelected={() => { api.pushHistory(); api.deleteIds(api.selection); }}
        onAuditionSelected={() => {
          const selected = api.notes.filter((n) => api.selection.has(n.id));
          selected.forEach((n, i) => window.setTimeout(() => audition(n.pitch, n.velocity, n.duration), i * 60));
        }}
        stems={stemItems}
        editingStem={editingStem}
        onEditingStemChange={onEditingStemChange}
        tracks={tracks.map((t, i) => ({ index: i, label: `${i + 1}. ${t.name || t.id}` }))}
        editingTrackIndex={safeTrackIndex}
        onEditingTrackIndexChange={setEditingTrackIndex}
        onOpenAssistPanel={() => setPanelOpen((v) => !v)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((v) => !v)}
      />
      <AssistPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        cleanup={cleanupForm}
        onCleanupChange={setCleanupForm}
        onApplyCleanupCurrent={cleanupCurrentTrack}
        onApplyCleanupAllTracks={cleanupAllTracks}
        onApplyAiCleanup={applyAiCleanup}
        onReduceToTwoTracks={reduceToTwoTracks}
        onTransposeTrack={transposeTrack}
        onStretchTrack={stretchTrack}
        onSeek={seekPlayback}
        onPlayFrom={playFrom}
        currentPlayheadSec={playhead}
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
              onBlankSeek={seekPlayback}
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
