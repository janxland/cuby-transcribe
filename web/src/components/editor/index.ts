/**
 * editor 子模块的对外门面 —— 调用方只需 `import { ScoreEditor } from "./editor"`。
 * 其余 hook / 几何 / 工具栏内部组件按需暴露给单元测试使用。
 */
export { ScoreEditor } from "./ScoreEditor";
export { useScoreEditor } from "./useScoreEditor";
export * as geometry from "./geometry";
export type { EditorNote, EditorViewport, GridConfig, Tool } from "./types";
