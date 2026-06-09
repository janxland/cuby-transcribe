"""100% 保真多 stem 多乐器扒谱 · v0.

设计原则（与 processor 主路径正交）：
  1. **零驯化**：不移调、不量化吸附、不限制音域、不单音化、不 voicing reducer。
     所有「光遇 15/25 键适配」交给前端 editor 自己处理。
  2. **多 stem 多 track**：Demucs 分离每条 stem，用最适合该 stem 的算法独立转录，
     合并到同一份 CubyScore 的多个 track 上 —— 与商业「爱扒谱」形态对齐。
  3. **算法选择**（每条 stem 选最强方案）：
        vocals          → PYIN/Viterbi 单音连续旋律（melody_extractor）
        piano/guitar    → Basic Pitch 复音（保留和弦/装饰）
        bass            → Basic Pitch 复音（低音区天然单音占绝大多数）
        other / 整曲    → Basic Pitch 复音
        drums           → 跳过（无音高语义）

  4. **过滤策略最小化**：仅去掉极短(<25ms) + 极弱(vel<8) 的毛刺，
     **不做音域百分位过滤、不做密度压制** —— 保留 88 键全音域。

返回结构与主路径一致：list[Track] 形式的 dict。
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Dict, List, Optional, Tuple

from loguru import logger


# 仅做极弱毛刺剔除，不做音域/密度过滤
_RAW_MIN_DUR = 0.025
_RAW_MIN_VEL = 8
_TWO_HAND_SOURCES = {"no_vocals", "original", "other", "piano", "guitar"}


def _basic_pitch_raw(audio_path: str) -> List[dict]:
    """Basic Pitch 复音转录，**不**走 transcriber._filter_ghost_notes。"""
    from basic_pitch.inference import predict, Model
    from .transcriber import _resolve_model_path

    model_path = _resolve_model_path()
    _model_output, _midi_data, note_events = predict(audio_path, Model(model_path))

    notes: List[dict] = []
    for start, end, pitch, velocity, _bends in note_events:
        if end <= start:
            continue
        dur = float(end) - float(start)
        vel_int = int(velocity * 127) if velocity <= 1 else int(velocity)
        vel_int = max(1, min(127, vel_int))
        if dur < _RAW_MIN_DUR and vel_int < _RAW_MIN_VEL * 2:
            continue
        if vel_int < _RAW_MIN_VEL:
            continue
        notes.append({
            "pitch": int(pitch),
            "start": float(start),
            "end": float(end),
            "velocity": vel_int,
        })
    notes.sort(key=lambda n: n["start"])
    return notes


def _pyin_raw(
    audio_path: str,
    bpm: Optional[float],
    backend: str = "pyin",
    min_note_sec: float = 0.10,
    merge_gap_sec: float = 0.08,
    voiced_thresh: float = 0.60,
) -> List[dict]:
    """对人声 stem 用单音旋律线（默认 PYIN；可选 CREPE）。"""
    from . import melody_extractor
    notes, _ = melody_extractor.extract(
        audio_path,
        bpm=bpm,
        backend=backend,
        voiced_thresh=voiced_thresh,
        min_note_sec=min_note_sec,
        merge_gap_sec=merge_gap_sec,
    )
    return notes


# stem → 算法策略
_PITCHED_STEMS = {"vocals", "bass", "other", "piano", "guitar", "no_vocals", "original"}


def _algo_for(stem: str) -> str:
    if stem == "vocals":
        return "pyin"
    if stem == "drums":
        return "skip"
    return "basic_pitch"


# 友好显示
_INSTRUMENT_NAME = {
    "vocals": "Vocals (PYIN)",
    "piano": "Piano",
    "guitar": "Guitar",
    "bass": "Bass",
    "other": "Other (Synth/Strings)",
    "no_vocals": "Accompaniment",
    "original": "Full Mix",
    "drums": "Drums",
}


def _to_score_note(n: dict) -> dict:
    return {
        "pitch": int(n["pitch"]),
        "time": round(float(n["start"]), 4),
        "duration": round(float(n["end"]) - float(n["start"]), 4),
        "velocity": int(n.get("velocity", 90)),
    }


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return float(ordered[mid - 1] + ordered[mid]) / 2.0


def _split_two_hands(track: dict, grid_sec: float = 0.08) -> List[dict]:
    """把单条复音伴奏轨拆成左右手两条钢琴轨，尽量贴近 MIDISHOW 的双钢琴结构。"""
    notes = list(track.get("notes") or [])
    if len(notes) < 32:
        return [track]

    pitches = [int(n["pitch"]) for n in notes]
    if max(pitches) - min(pitches) < 18:
        return [track]

    t_end = max((float(n["time"]) + float(n["duration"]) for n in notes), default=0.0)
    if t_end <= 0:
        return [track]

    split_samples: List[List[float]] = [[] for _ in notes]
    n_frames = max(1, int(t_end / grid_sec) + 1)
    poly_frames = 0
    wide_poly_frames = 0

    for frame_idx in range(n_frames):
        t0 = frame_idx * grid_sec
        t1 = t0 + grid_sec
        active: List[tuple[int, dict]] = []
        for idx, note in enumerate(notes):
            start = float(note["time"])
            end = start + float(note["duration"])
            if start < t1 and end > t0:
                active.append((idx, note))
        if len(active) < 2:
            continue

        poly_frames += 1
        active.sort(key=lambda item: (int(item[1]["pitch"]), float(item[1]["time"])))
        low_pitch = int(active[0][1]["pitch"])
        high_pitch = int(active[-1][1]["pitch"])
        if high_pitch - low_pitch < 7:
            continue

        wide_poly_frames += 1
        boundary = (low_pitch + high_pitch) / 2.0
        for idx, _note in active:
            split_samples[idx].append(boundary)

    if poly_frames < 8 or wide_poly_frames < 4:
        return [track]

    global_split = _median([sample for samples in split_samples for sample in samples])
    if global_split <= 0:
        global_split = _median([float(p) for p in pitches])

    right_hand: List[dict] = []
    left_hand: List[dict] = []
    for idx, note in enumerate(notes):
        local_split = _median(split_samples[idx]) if split_samples[idx] else global_split
        target = right_hand if float(note["pitch"]) >= local_split else left_hand
        target.append(note)

    min_hand_notes = max(12, int(len(notes) * 0.15))
    if len(right_hand) < min_hand_notes or len(left_hand) < min_hand_notes:
        return [track]

    left_hand.sort(key=lambda n: (float(n["time"]), int(n["pitch"])))
    right_hand.sort(key=lambda n: (float(n["time"]), int(n["pitch"])))

    return [
        {
            "id": track.get("id", "track") + "_rh",
            "name": "Piano RH",
            "instrument": "Grand Piano",
            "notes": right_hand,
        },
        {
            "id": track.get("id", "track") + "_lh",
            "name": "Piano LH",
            "instrument": "Grand Piano",
            "notes": left_hand,
        },
    ]


def split_two_hand_tracks(tracks: List[dict], algos: Dict[str, str]) -> Tuple[List[dict], Dict[str, str]]:
    """对适合的 raw 轨道做左右手钢琴分轨；不满足条件时保持原样。"""
    if not tracks:
        return tracks, algos

    out_tracks: List[dict] = []
    out_algos: Dict[str, str] = {}
    next_id = 1

    for track in tracks:
        source_name = str(track.get("name") or "")
        split_tracks = [track]
        if source_name in _TWO_HAND_SOURCES:
            split_tracks = _split_two_hands(track)
            if len(split_tracks) == 2:
                logger.info(
                    f"[raw] split '{source_name}' -> RH {len(split_tracks[0]['notes'])} / LH {len(split_tracks[1]['notes'])}"
                )

        for part in split_tracks:
            normalized = {
                **part,
                "id": f"track_{next_id}",
            }
            next_id += 1
            out_tracks.append(normalized)
            out_algos[normalized["name"]] = algos.get(source_name, algos.get(normalized["name"], "basic_pitch"))

    return out_tracks, out_algos


def transcribe_stems(
    stem_paths: Dict[str, str],
    bpm: Optional[float] = None,
    melody_backend: str = "pyin",
    vocal_min_note_sec: float = 0.10,
    vocal_merge_gap_sec: float = 0.08,
    vocal_voiced_thresh: float = 0.60,
) -> Tuple[List[dict], Dict[str, str]]:
    """对所有给定 stem 并行转录，返回 (tracks, algo_per_stem)。

    tracks: [{ id, name, instrument, notes:[{pitch,time,duration,velocity}] }, ...]
    algo_per_stem: { stem_name: 'pyin'|'basic_pitch'|'skip' }
    """
    tracks: List[dict] = []
    algos: Dict[str, str] = {}
    if not stem_paths:
        return tracks, algos

    # IO/CPU bound 都有；给 stems 一个并行池（数量不多，<=6）
    pool = ThreadPoolExecutor(max_workers=min(6, len(stem_paths)))
    futures: Dict[str, Future] = {}
    for name, path in stem_paths.items():
        algo = _algo_for(name)
        algos[name] = algo
        if algo == "skip":
            logger.info(f"[raw] skip stem '{name}' (no pitched content)")
            continue
        if algo == "pyin":
            futures[name] = pool.submit(
                _pyin_raw,
                path,
                bpm,
                melody_backend,
                vocal_min_note_sec,
                vocal_merge_gap_sec,
                vocal_voiced_thresh,
            )
        else:
            futures[name] = pool.submit(_basic_pitch_raw, path)

    for idx, (name, fut) in enumerate(futures.items(), start=1):
        try:
            notes = fut.result()
        except Exception as e:
            logger.warning(f"[raw] stem '{name}' transcribe failed: {e}")
            notes = []
        logger.info(f"[raw] stem '{name}' algo={algos[name]} → {len(notes)} notes")
        tracks.append({
            "id": f"track_{idx}",
            "name": name,
            "instrument": _INSTRUMENT_NAME.get(name, name.title()),
            "notes": [_to_score_note(n) for n in notes],
        })

    pool.shutdown(wait=False)
    return tracks, algos


def transcribe_single(audio_path: str, bpm: Optional[float] = None) -> List[dict]:
    """没有分离时的单 stem 路径：整曲 Basic Pitch 复音保真。"""
    return _basic_pitch_raw(audio_path)
