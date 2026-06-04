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


def _pyin_raw(audio_path: str, bpm: Optional[float]) -> List[dict]:
    """对人声 stem 用 PYIN+Viterbi 单音旋律线。"""
    from . import melody_extractor
    notes, _ = melody_extractor.extract(audio_path, bpm=bpm)
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


def transcribe_stems(
    stem_paths: Dict[str, str],
    bpm: Optional[float] = None,
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
            futures[name] = pool.submit(_pyin_raw, path, bpm)
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
