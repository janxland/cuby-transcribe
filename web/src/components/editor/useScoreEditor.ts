/**
 * 编辑器状态机：
 *  - `present`  : 当前可见的所有音符（含稳定 id）
 *  - `selection`: 选中音符 id 集合
 *  - past / future 双栈实现 undo / redo
 *
 * 设计要点：
 *  - 突变 API（add / patch / delete）**不会**自动入栈；调用方在拖动开始处调用 `pushHistory()`，
 *    拖动期间任意频次的 patch 不再制造新历史快照 —— 体验上一次撤销=一次完整操作。
 *  - 任何会改变 present 的状态变化都会经 `onChange` 派发回外层（写回 store）。
 *  - 不监听 `initial` 后续变化 —— 切 stem 由外层 `key` 强制重挂载 hook，避免双向反馈。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorNote } from "./types";
import { toScoreNotes } from "./types";
import type { Note as ScoreNote } from "../../types";

const HISTORY_LIMIT = 100;

export interface ScoreEditorApi {
  notes: EditorNote[];
  selection: Set<string>;

  // 选择
  select: (ids: Iterable<string>, mode?: "replace" | "toggle" | "add") => void;
  clearSelection: () => void;
  selectAll: () => void;

  // 突变（不自动入栈，调用方在交互开始处显式 pushHistory）
  pushHistory: () => void;
  addNote: (n: Omit<EditorNote, "id">) => string;
  deleteIds: (ids: Iterable<string>) => void;
  patchIds: (ids: Iterable<string>, fn: (n: EditorNote) => EditorNote) => void;
  replaceAll: (notes: EditorNote[]) => void;

  // 历史
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

let _seq = 0;
const newId = () => `n${Date.now().toString(36)}${(_seq++).toString(36)}`;

export function useScoreEditor(
  initial: EditorNote[],
  onChange: (notes: ScoreNote[]) => void,
): ScoreEditorApi {
  const [present, setPresent] = useState<EditorNote[]>(() => initial);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const pastRef = useRef<EditorNote[][]>([]);
  const futureRef = useRef<EditorNote[][]>([]);
  const [historyTick, setHistoryTick] = useState(0); // 仅为触发 canUndo/canRedo 重算

  // ── 写回外层（不在 mount 时触发，避免与初始 score 冗余）─────────
  const firstRef = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    onChangeRef.current(toScoreNotes(present));
  }, [present]);

  // ── 历史 ──────────────────────────────────────────────────
  const pushHistory = useCallback(() => {
    pastRef.current.push(present);
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, [present]);

  const undo = useCallback(() => {
    setPresent((cur) => {
      const prev = pastRef.current.pop();
      if (!prev) return cur;
      futureRef.current.push(cur);
      setHistoryTick((t) => t + 1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setPresent((cur) => {
      const next = futureRef.current.pop();
      if (!next) return cur;
      pastRef.current.push(cur);
      setHistoryTick((t) => t + 1);
      return next;
    });
  }, []);

  // ── 选择 ──────────────────────────────────────────────────
  const select = useCallback(
    (ids: Iterable<string>, mode: "replace" | "toggle" | "add" = "replace") => {
      setSelection((cur) => {
        if (mode === "replace") return new Set(ids);
        const next = new Set(cur);
        for (const id of ids) {
          if (mode === "toggle") next.has(id) ? next.delete(id) : next.add(id);
          else next.add(id);
        }
        return next;
      });
    },
    [],
  );
  const clearSelection = useCallback(() => setSelection(new Set()), []);
  const selectAll = useCallback(() => {
    setSelection(new Set(present.map((n) => n.id)));
  }, [present]);

  // ── 突变 ──────────────────────────────────────────────────
  const addNote: ScoreEditorApi["addNote"] = useCallback((n) => {
    const id = newId();
    setPresent((p) => [...p, { ...n, id }]);
    return id;
  }, []);

  const deleteIds: ScoreEditorApi["deleteIds"] = useCallback((ids) => {
    const set = new Set(ids);
    if (!set.size) return;
    setPresent((p) => p.filter((n) => !set.has(n.id)));
    setSelection((cur) => {
      let touched = false;
      const next = new Set(cur);
      for (const id of set) if (next.delete(id)) touched = true;
      return touched ? next : cur;
    });
  }, []);

  const patchIds: ScoreEditorApi["patchIds"] = useCallback((ids, fn) => {
    const set = new Set(ids);
    if (!set.size) return;
    setPresent((p) => p.map((n) => (set.has(n.id) ? fn(n) : n)));
  }, []);

  const replaceAll: ScoreEditorApi["replaceAll"] = useCallback((notes) => {
    setPresent(notes);
  }, []);

  // historyTick used only for memo invalidation
  void historyTick;

  return {
    notes: present,
    selection,
    select, clearSelection, selectAll,
    pushHistory, addNote, deleteIds, patchIds, replaceAll,
    undo, redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
