// 单一 stem 注册表：图标 / 中文标签 / 渐变色 / 各分离模式包含的 stems
// 之前在 Uploader.tsx / StemsPanel.tsx 分别维护两份，已合并到这里。
import type { SeparationMode } from "./types";

export const STEM_REGISTRY = {
  original:  { icon: "🎼", label: "原音", color: "from-slate-500 to-slate-700" },
  vocals:    { icon: "🎤", label: "人声", color: "from-pink-500 to-rose-500" },
  no_vocals: { icon: "🎵", label: "伴奏", color: "from-sky-500 to-cyan-500" },
  drums:     { icon: "🥁", label: "鼓",   color: "from-amber-500 to-orange-500" },
  bass:      { icon: "🎸", label: "贝斯", color: "from-violet-500 to-purple-600" },
  other:     { icon: "🎹", label: "其它", color: "from-emerald-500 to-teal-500" },
} as const;

export type StemName = keyof typeof STEM_REGISTRY;

export const STEMS_BY_MODE: Record<SeparationMode, readonly StemName[]> = {
  none:     ["original"],
  vocals:   ["vocals", "no_vocals"],
  "4stems": ["vocals", "drums", "bass", "other"],
};

export function stemMeta(name: string) {
  return (STEM_REGISTRY as Record<string, { icon: string; label: string; color: string }>)[name]
      ?? { icon: "🎼", label: name, color: "from-slate-500 to-slate-700" };
}
