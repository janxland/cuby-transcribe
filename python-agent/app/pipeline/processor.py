"""完整流水线：音频 → CubyScore。"""
from __future__ import annotations
import os
import time
from loguru import logger

from ..models import CubyScore, Meta, Track, Note, Metadata, ProcessOptions
from . import transcriber, key_detector, sky_mapper


def run(audio_path: str, options: ProcessOptions) -> dict:
    t0 = time.time()
    if not os.path.exists(audio_path):
        raise FileNotFoundError(audio_path)

    # 1. 转录
    raw_notes, bpm = transcriber.transcribe(audio_path)
    if not raw_notes:
        raise RuntimeError("No notes detected from audio")

    # 2. 调性检测
    key_info = key_detector.detect_key(raw_notes)
    logger.info(f"Detected key: {key_info}")

    # 3. 转调到 C
    notes = raw_notes
    if options.transposeToC:
        notes = sky_mapper.transpose(notes, key_info["transposeToC"])

    # 4. 15 键映射
    sky_notes = sky_mapper.process(
        notes, bpm, simplify=options.simplifyMelody, grid=options.quantizeGrid
    )

    # 5. 构造 CubyScore
    duration = max((n["end"] for n in raw_notes), default=0.0)
    title = os.path.splitext(os.path.basename(audio_path))[0]

    score = CubyScore(
        meta=Meta(
            title=title,
            bpm=round(bpm, 2),
            keySignature="C" if options.transposeToC else key_info["key"],
        ),
        tracks=[
            Track(
                id="track_1",
                name="Melody",
                instrument="sky_15",
                notes=[
                    Note(
                        pitch=n["pitch"],
                        time=round(n["start"], 4),
                        duration=round(n["end"] - n["start"], 4),
                        velocity=n.get("velocity", 90),
                    )
                    for n in sky_notes
                ],
            )
        ],
    )

    meta = Metadata(
        detectedKey=key_info["key"],
        detectedMode=key_info["mode"],
        bpm=round(bpm, 2),
        duration=round(duration, 2),
        noteCount=len(sky_notes),
        elapsed=round(time.time() - t0, 2),
    )

    return {"cubyScore": score.model_dump(), "metadata": meta.model_dump()}
