// 单一 stem 注册表：图标 / 中文标签 / 渐变色 / 各分离模式包含的 stems
// 之前在 Uploader.tsx / StemsPanel.tsx 分别维护两份，已合并到这里。
import type { SeparationMode } from "./types";

export const STEM_REGISTRY = {
  original:  { icon: "🎼", label: "原音", color: "from-slate-500 to-slate-700" },
  vocals:    { icon: "🎤", label: "人声", color: "from-pink-500 to-rose-500" },
  no_vocals: { icon: "🎵", label: "伴奏", color: "from-sky-500 to-cyan-500" },
  drums:     { icon: "🥁", label: "鼓",   color: "from-amber-500 to-orange-500" },
  bass:      { icon: "🎸", label: "贝斯", color: "from-violet-500 to-purple-600" },
  piano:     { icon: "🎹", label: "钢琴", color: "from-fuchsia-500 to-pink-600" },
  guitar:    { icon: "🎸", label: "吉他", color: "from-orange-500 to-red-600" },
  other:     { icon: "🎶", label: "其它", color: "from-emerald-500 to-teal-500" },
} as const;

export type StemName = keyof typeof STEM_REGISTRY;

export const STEMS_BY_MODE: Record<SeparationMode, readonly StemName[]> = {
  none:     ["original"],
  vocals:   ["vocals", "no_vocals"],
  "4stems": ["vocals", "drums", "bass", "other"],
  "6stems": ["vocals", "drums", "bass", "other", "piano", "guitar"],
};

/** 可被用户多选的"乐器/人声"集合（不含 original / no_vocals） */
export const SELECTABLE_STEMS: readonly StemName[] = [
  "vocals", "drums", "bass", "other", "piano", "guitar",
];

/**
 * 根据用户勾选的 stems 反推所需的最经济分离模式：
 *   - 空 → none（直接整段扒）
 *   - 仅 {vocals}（含可叠加的 no_vocals）→ vocals（2-stem，最快）
 *   - 包含 piano / guitar → 6stems（htdemucs_6s）
 *   - 其余 ⊂ {vocals,drums,bass,other} → 4stems
 */
export function deriveMode(stems: readonly StemName[]): SeparationMode {
  if (!stems.length) return "none";
  if (stems.includes("piano") || stems.includes("guitar")) return "6stems";
  const set = new Set(stems);
  if (set.size <= 2 && [...set].every((s) => s === "vocals" || s === "no_vocals")) {
    return "vocals";
  }
  return "4stems";
}

export function stemMeta(name: string) {
  return (STEM_REGISTRY as Record<string, { icon: string; label: string; color: string }>)[name]
      ?? { icon: "🎼", label: name, color: "from-slate-500 to-slate-700" };
}
