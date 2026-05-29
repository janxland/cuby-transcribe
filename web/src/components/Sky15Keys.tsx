import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "../store";
import { useMixerOptional } from "./mixer";
import { Transport } from "./mixer/Transport";
import { StemsPanel } from "./StemsPanel";
import { PRESETS, playNote, type PresetId } from "./synth";
import { stemMeta } from "../stems";
import type { Note } from "../types";

// 光遇 15 键，按游戏内 3 行 × 5 列布局
const SKY_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
const LABELS = ["1", "2", "3", "4", "5", "Q", "W", "E", "R", "T", "A", "S", "D", "F", "G"];
const KEY_MAP: Record<string, number> = {
  "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
  "q": 5, "w": 6, "e": 7, "r": 8, "t": 9,
  "a": 10, "s": 11, "d": 12, "f": 13, "g": 14,
};

/** 已排序的、按所属 stem 标记过音色来源的音符流 —— 调度器与高亮共享同一份数据 */
interface SchedNote { time: number; duration: number; pitch: number; stem: string; }

/**
 * 「光遇 15 键」= score 播放器：
 *  - 顶部 Transport 控制 mixer（全局唯一时钟）
 *  - 调度器跟随 mixer.time，把 **所有 activeStems 的 score** 合并成一条按时间排序的音符流，
 *    每个音符按其所属 stem 的音色（preset）触发，自然支持多谱同时弹奏
 *  - 点亮的键也是多 score 的并集
 *  - 顶部「演奏轨」chip 行：每条 active stem 一颗，独立选音色 + × 按钮即可移出
 *  - 底部可上拉混音台抽屉，做联动 A/B 对比
 */
export function Sky15Keys() {
  const { scores, activeStems, toggleActiveStem } = useStore();
  const mixer = useMixerOptional();

  // 每条 stem 一个 preset；状态本地维护，stem 退出 active 时保留偏好以便再次加入恢复
  const [presetMap, setPresetMap] = useState<Record<string, PresetId>>({});
  const presetOf = useCallback((stem: string): PresetId => presetMap[stem] ?? "piano", [presetMap]);
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── 把 active 集合内的所有音符合并成一条按时间排序的流 ────────
  const stream: SchedNote[] = useMemo(() => {
    const out: SchedNote[] = [];
    for (const stem of activeStems) {
      const ns: Note[] = scores[stem]?.score?.tracks?.[0]?.notes ?? [];
      for (const n of ns) out.push({ time: n.time, duration: n.duration, pitch: n.pitch, stem });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }, [activeStems, scores]);

  // 热力图：所有 active 谱子合计
  const counts = useMemo(() => {
    const arr = new Array(15).fill(0);
    for (const n of stream) {
      const i = SKY_KEYS.indexOf(n.pitch);
      if (i >= 0) arr[i] += 1;
    }
    return arr;
  }, [stream]);
  const maxCount = Math.max(1, ...counts);

  // ── 当前播放头下应当点亮的键 ──────────────────────────────
  const playheadTime = mixer?.time ?? 0;
  const followMixer = !!mixer && mixer.playing;
  const autoActive = useMemo(() => {
    const set = new Set<number>();
    if (!followMixer) return set;
    for (const n of stream) {
      if (playheadTime >= n.time && playheadTime < n.time + n.duration) {
        const i = SKY_KEYS.indexOf(n.pitch);
        if (i >= 0) set.add(i);
      }
    }
    return set;
  }, [stream, playheadTime, followMixer]);

  // ── 单次触发：用指定 preset 合成 + 视觉脉冲 ──────────────────
  const fireNote = useCallback((pitch: number, preset: PresetId) => {
    void playNote(preset, pitch);
    const i = SKY_KEYS.indexOf(pitch);
    if (i >= 0) {
      setPressed((s) => { const n = new Set(s); n.add(i); return n; });
      window.setTimeout(() => {
        setPressed((s) => { const n = new Set(s); n.delete(i); return n; });
      }, 180);
    }
  }, []);

  // 手动点击/键盘弹奏：使用「主显 stem 的 preset」，无 active 则回退到 piano
  const manualPreset: PresetId = activeStems[0] ? presetOf(activeStems[0]) : "piano";
  const triggerManual = useCallback(
    (idx: number) => fireNote(SKY_KEYS[idx], manualPreset),
    [fireNote, manualPreset],
  );

  // ── 键盘快捷键 ──────────────────────────────────────────────
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      const idx = KEY_MAP[e.key.toLowerCase()];
      if (idx === undefined) return;
      e.preventDefault();
      triggerManual(idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerManual]);

  // ── 自动弹奏调度器：跟随 mixer.time 推进，多谱同步触发 ──────
  const lastTimeRef = useRef(0);
  useEffect(() => {
    if (mixer) lastTimeRef.current = mixer.time;
  }, [mixer?.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!followMixer) return;
    const t = mixer!.time;
    const last = lastTimeRef.current;
    // seek / 大跨度跳变：丢弃未处理区间，重新对齐
    if (t < last || t - last > 0.5) {
      lastTimeRef.current = t;
      return;
    }
    if (t > last) {
      for (const n of stream) {
        if (n.time <= last) continue;
        if (n.time > t) break;
        fireNote(n.pitch, presetOf(n.stem));
      }
      lastTimeRef.current = t;
    }
  }, [mixer?.time, followMixer, stream, fireNote, presetOf]);

  // 主显 score 的 bpm（如果有）—— 给 Transport 显示用
  const primaryStem = activeStems[0];
  const bpm = primaryStem ? (scores[primaryStem]?.meta?.bpm as number | undefined) : undefined;

  return (
    <div className="flex flex-col gap-3">
      {mixer && <Transport bpm={bpm} />}

      {/* 15 键主面板 */}
      <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 space-y-4">
        {/* 演奏轨 chip 行：每条 active stem 独立选音色 + × 移出 */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mt-1.5">演奏轨</span>
          {activeStems.length === 0 ? (
            <span className="text-xs text-slate-500 py-1.5">
              在上方「演奏谱子」或「音轨混音」点击 ✓ / 👁 即可加入；支持多个谱子同时弹奏
            </span>
          ) : (
            activeStems.map((stem, i) => {
              const sm = stemMeta(stem);
              const noteCount = scores[stem]?.score?.tracks?.[0]?.notes?.length ?? 0;
              return (
                <StemPresetChip
                  key={stem}
                  stem={stem}
                  label={sm.label}
                  icon={sm.icon}
                  isPrimary={i === 0}
                  noteCount={noteCount}
                  preset={presetOf(stem)}
                  onPresetChange={(p) => setPresetMap((m) => ({ ...m, [stem]: p }))}
                  onRemove={() => toggleActiveStem(stem)}
                />
              );
            })
          )}
        </div>

        {/* 15 键网格 */}
        <div className="grid grid-cols-5 gap-3 max-w-md mx-auto">
          {SKY_KEYS.map((pitch, i) => {
            const lit = autoActive.has(i) || pressed.has(i);
            const heat = counts[i] / maxCount;
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); triggerManual(i); }}
                onTouchStart={(e) => { e.preventDefault(); triggerManual(i); }}
                className={[
                  "aspect-square rounded-xl flex flex-col items-center justify-center font-mono",
                  "transition-all duration-100 border-2 relative overflow-hidden select-none cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-400/60",
                  lit
                    ? "border-amber-300 bg-amber-400 text-slate-900 scale-110 shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                    : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500 active:scale-95",
                ].join(" ")}
                title={`点击弹奏 / 键盘 ${LABELS[i]}`}
              >
                {!lit && (
                  <div
                    className="absolute inset-0 bg-indigo-500 pointer-events-none"
                    style={{ opacity: heat * 0.4 }}
                  />
                )}
                <span className="relative text-lg font-bold">{LABELS[i]}</span>
                <span className="relative text-[10px] opacity-70">{pitchName(pitch)}</span>
                <span className="relative text-[10px] opacity-50 mt-0.5">×{counts[i]}</span>
              </button>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-500 text-center">
          按 <Kbd>Space</Kbd> 播放谱子 · 鼠标 / 键盘 <Kbd>1-5</Kbd> <Kbd>QWERT</Kbd> <Kbd>ASDFG</Kbd> 手动弹奏
        </div>
      </div>

      {/* 上拉抽屉：完整混音台（联动 A/B 对比） */}
      {mixer && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/40 transition"
            title={drawerOpen ? "收起混音台" : "拉起混音台，联动对比原音 / 各 stem"}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="font-medium">混音控制台</span>
            <span className="text-slate-500">— 拉起后可与 15 键联动播放、A/B 对比</span>
            <span className="ml-auto">
              {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </span>
          </button>
          {drawerOpen && (
            <div className="border-t border-slate-800 h-[420px]">
              <StemsPanel withTransport={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 单条「演奏轨」chip：icon + label + preset 选择器 + ×
// ─────────────────────────────────────────────────────────────
function StemPresetChip({
  stem, label, icon, isPrimary, noteCount, preset, onPresetChange, onRemove,
}: {
  stem: string; label: string; icon: string; isPrimary: boolean; noteCount: number;
  preset: PresetId; onPresetChange: (p: PresetId) => void; onRemove: () => void;
}) {
  return (
    <div
      className={[
        "flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-xs",
        isPrimary
          ? "bg-amber-400/15 border-amber-400/60"
          : "bg-slate-800/60 border-slate-700",
      ].join(" ")}
      title={`${label} · ${noteCount} 个音符${isPrimary ? "（主显）" : ""}`}
    >
      <span className="px-1">{icon}</span>
      <span className={isPrimary ? "text-amber-100" : "text-slate-200"}>{label}</span>
      <span className="text-[10px] text-slate-500">×{noteCount}</span>
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as PresetId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-400"
        title="切换音色"
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title={`从演奏列表移出 ${label}`}
        className="p-0.5 rounded hover:bg-rose-500/30 text-slate-400 hover:text-rose-100"
      >
        <X className="w-3 h-3" />
      </button>
      {/* 阻止 select 上的字体大小影响 chip 高度 */}
      <span className="sr-only">{stem}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-0.5 mx-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
      {children}
    </kbd>
  );
}

function pitchName(p: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[p % 12]}${Math.floor(p / 12) - 1}`;
}
