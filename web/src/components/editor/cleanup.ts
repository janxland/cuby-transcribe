import type { EditorNote } from "./types";

export interface CleanupOptions {
  bpm: number;
  minDivision?: 16 | 32 | 64;
  pitchMin?: number;
  pitchMax?: number;
  dedupeWindowSec?: number;
  mergeGapSec?: number;
}

export interface CleanupStats {
  before: number;
  after: number;
  removedShort: number;
  removedOutOfRange: number;
  removedDuplicate: number;
  mergedPairs: number;
}

export function cleanTrackNotes(notes: EditorNote[], opts: CleanupOptions): { notes: EditorNote[]; stats: CleanupStats } {
  const bpm = Math.max(30, opts.bpm || 120);
  const minDivision = opts.minDivision ?? 32;
  const pitchMin = opts.pitchMin ?? 40;
  const pitchMax = opts.pitchMax ?? 90;
  const dedupeWindowSec = opts.dedupeWindowSec ?? 0.04;
  const mergeGapSec = opts.mergeGapSec ?? 0.03;

  const minDur = (60 / bpm) * (4 / minDivision);

  const stats: CleanupStats = {
    before: notes.length,
    after: notes.length,
    removedShort: 0,
    removedOutOfRange: 0,
    removedDuplicate: 0,
    mergedPairs: 0,
  };

  let out = notes
    .filter((n) => Number.isFinite(n.time) && Number.isFinite(n.duration) && Number.isFinite(n.pitch))
    .map((n) => ({ ...n }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch || b.duration - a.duration);

  // 1) Pitch range filter.
  const beforeRange = out.length;
  out = out.filter((n) => n.pitch >= pitchMin && n.pitch <= pitchMax);
  stats.removedOutOfRange = beforeRange - out.length;

  // 2) Remove short notes.
  const beforeShort = out.length;
  out = out.filter((n) => n.duration >= minDur);
  stats.removedShort = beforeShort - out.length;

  // 3) Remove near-duplicate resonant notes (same pitch, near-same onset).
  const deduped: EditorNote[] = [];
  for (const n of out) {
    const prev = deduped.length ? deduped[deduped.length - 1] : null;
    if (
      prev &&
      prev.pitch === n.pitch &&
      Math.abs(prev.time - n.time) <= dedupeWindowSec
    ) {
      // keep louder/longer one
      const prevScore = prev.velocity * 2 + prev.duration;
      const curScore = n.velocity * 2 + n.duration;
      if (curScore > prevScore) {
        deduped[deduped.length - 1] = n;
      }
      stats.removedDuplicate += 1;
      continue;
    }
    deduped.push(n);
  }

  // 4) Merge same-pitch neighbors split by tiny gaps.
  const merged: EditorNote[] = [];
  for (const n of deduped) {
    const prev = merged.length ? merged[merged.length - 1] : null;
    if (!prev) {
      merged.push(n);
      continue;
    }

    const prevEnd = prev.time + prev.duration;
    const gap = n.time - prevEnd;
    if (prev.pitch === n.pitch && gap >= 0 && gap <= mergeGapSec) {
      prev.duration = Math.max(prev.duration, n.time + n.duration - prev.time);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      stats.mergedPairs += 1;
      continue;
    }

    merged.push(n);
  }

  stats.after = merged.length;
  return { notes: merged, stats };
}

export function splitToTwoTracksByPitch(notes: EditorNote[]): [EditorNote[], EditorNote[]] {
  if (notes.length < 2) return [notes, []];
  const sortedPitch = [...notes].sort((a, b) => a.pitch - b.pitch);
  const median = sortedPitch[Math.floor(sortedPitch.length / 2)].pitch;
  const high = notes.filter((n) => n.pitch >= median);
  const low = notes.filter((n) => n.pitch < median);
  if (!high.length || !low.length) return [notes, []];
  return [high, low];
}
