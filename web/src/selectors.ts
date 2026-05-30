/**
 * Zustand selectors：用 shallow 比较 + 派生计算，避免组件订阅整包 store
 * 引发的高频无效重渲染；同时把"主显 score / meta"等派生数据集中在此。
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type ScoreEntry } from "./store";
import type { CubyScore, Metadata } from "./types";

/**
 * 选择 store 的若干字段，仅当任意字段引用变化时重渲染（shallow 比较）。
 *
 * 用法：
 * ```ts
 * const { audioUrl, file } = useStoreShallow(s => ({ audioUrl: s.audioUrl, file: s.file }));
 * ```
 */
export function useStoreShallow<T>(selector: (s: ReturnType<typeof useStore.getState>) => T): T {
  return useStore(useShallow(selector));
}

/** 当前主显 stem 名（activeStems[0]），无则 null */
export function usePrimaryStem(): string | null {
  return useStore((s) => s.activeStems[0] ?? null);
}

/** 主显 stem 对应的 ScoreEntry —— 引用稳定，scores[stem] 未变时不会触发重渲染 */
export function usePrimaryEntry(): ScoreEntry | null {
  return useStore((s) => {
    const stem = s.activeStems[0];
    return stem ? s.scores[stem] ?? null : null;
  });
}

export function usePrimaryScore(): CubyScore | null {
  return usePrimaryEntry()?.score ?? null;
}

export function usePrimaryMeta(): Metadata | null {
  return usePrimaryEntry()?.meta ?? null;
}

/** 已生成扒谱的 stem 列表（含每条音符数）—— 用于 ScoreViewer 的 chip 行 */
export function useScoreList(): { stem: string; noteCount: number }[] {
  const scores = useStore((s) => s.scores);
  return useMemo(
    () => Object.entries(scores).map(([stem, e]) => ({
      stem,
      noteCount: e.score.tracks?.[0]?.notes?.length ?? 0,
    })),
    [scores],
  );
}
