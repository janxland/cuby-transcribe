import type { EditorNote } from "./types";

export type EditorOperation =
  | { type: "replace_all"; notes: EditorNote[] }
  | { type: "delete_ids"; ids: string[] }
  | { type: "patch_ids"; ids: string[]; patch: (note: EditorNote) => EditorNote }
  | { type: "add_note"; note: Omit<EditorNote, "id">; id?: string };
