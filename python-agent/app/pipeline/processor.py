"""完整流水线：音频 → (可选分离) → CubyScore。"""
from __future__ import annotations
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Optional
from loguru import logger

from ..models import CubyScore, Meta, Track, Note, Metadata, ProcessOptions, StemInfo
from . import transcriber, key_detector, sky_mapper


STEMS_ROOT = os.environ.get("STEMS_DIR", "/tmp/cuby-stems")
os.makedirs(STEMS_ROOT, exist_ok=True)


def _duration(path: str) -> float:
    try:
        import librosa
        return float(librosa.get_duration(path=path))
    except Exception:
        return 0.0


def run(audio_path: str, options: ProcessOptions, task_id: str | None = None) -> dict:
    t0 = time.time()
    if not os.path.exists(audio_path):
        raise FileNotFoundError(audio_path)

    task_id = task_id or uuid.uuid4().hex[:8]
    stems_dir = os.path.join(STEMS_ROOT, task_id)
    stems: list[StemInfo] = []

    audio_for_transcribe = audio_path
    transcribed_stem = "original"

    # BPM 一定从 **原曲** 测，且与「分离」阶段后台并行 —— 节省最长一段串行时间
    bpm_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bpm")
    bpm_future: Future = bpm_pool.submit(transcriber.detect_bpm, audio_path)
    bpm_pool.shutdown(wait=False)

    if options.separationMode != "none":
        from . import separator
        logger.info(f"[stage] separation mode={options.separationMode} stems={options.stems} (BPM running in parallel)")
        # 若用户指定了 transcribeStem，确保它一定被保留
        keep = list(options.stems) if options.stems else None
        if keep and options.transcribeStem and options.transcribeStem not in keep:
            keep.append(options.transcribeStem)
        stem_paths = separator.separate(
            audio_path, stems_dir, mode=options.separationMode, keep_stems=keep,
        )
        for name, path in stem_paths.items():
            stems.append(StemInfo(
                name=name,
                url=f"/internal/stems/{task_id}/{name}.wav",
                duration=_duration(path),
            ))

        want = options.transcribeStem or separator.default_stem_for_mode(options.separationMode)
        if want == "original":
            audio_for_transcribe = audio_path
        elif want in stem_paths:
            audio_for_transcribe = stem_paths[want]
            transcribed_stem = want
        else:
            logger.warning(f"requested stem '{want}' not found, fall back to original")
            audio_for_transcribe = audio_path

    # 等 BPM 拿回来（多数情况此时已 done）
    try:
        precomputed_bpm: Optional[float] = bpm_future.result(timeout=30)
    except Exception as e:
        logger.warning(f"[bpm] future failed: {e}")
        precomputed_bpm = None

    logger.info(f"[stage] transcribe ({transcribed_stem}) bpm={precomputed_bpm}")
    raw_notes, bpm = transcriber.transcribe(audio_for_transcribe, bpm=precomputed_bpm)
    if not raw_notes:
        raise RuntimeError("No notes detected from audio")

    key_info = key_detector.detect_key(raw_notes)
    logger.info(f"Detected key: {key_info}")

    notes = raw_notes
    if options.transposeToC:
        notes = sky_mapper.transpose(notes, key_info["transposeToC"])

    sky_notes = sky_mapper.process(
        notes, bpm, simplify=options.simplifyMelody, grid=options.quantizeGrid
    )

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
        transcribedStem=transcribed_stem,
    )

    return {
        "cubyScore": score.model_dump(),
        "metadata": meta.model_dump(),
        "stems": [s.model_dump() for s in stems],
        "taskId": task_id,
    }
