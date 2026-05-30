"""完整流水线：音频 → (可选分离) → CubyScore。"""
from __future__ import annotations
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Optional
from loguru import logger

from ..models import CubyScore, Meta, Track, Note, Metadata, ProcessOptions, StemInfo, ChordSegment
from . import (
    transcriber,
    key_detector,
    sky_mapper,
    melody_extractor,
    melody_picker,
    key_optimizer,
    chord_detector,
)

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


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
    # 「这次扒的是哪条 stem」由 options.transcribeStem 权威决定；
    # 无分离 + 未指定 → 视为原曲。分离流程下若实际找到对应 stem 会再次确认。
    transcribed_stem = options.transcribeStem or "original"

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

    # —— 选择旋律提取算法 ——
    # melodyMode='vocal' 且当前扒的是人声轨 → 走 PYIN 单音；否则回退 Basic Pitch
    use_pyin = options.melodyMode == "vocal" and transcribed_stem == "vocals"
    melody_algo = "pyin" if use_pyin else "basic_pitch"
    logger.info(f"[stage] transcribe ({transcribed_stem}) algo={melody_algo} bpm={precomputed_bpm}")
    if use_pyin:
        raw_notes, bpm = melody_extractor.extract(audio_for_transcribe, bpm=precomputed_bpm)
    else:
        raw_notes, bpm = transcriber.transcribe(audio_for_transcribe, bpm=precomputed_bpm)
    if not raw_notes:
        raise RuntimeError("No notes detected from audio")

    # —— 编配模式（v2）——
    # 旧字段 forceMonophonic 等价于 arrangementMode='monophonic'，二者并集。
    arrangement_mode = options.arrangementMode
    if options.forceMonophonic:
        arrangement_mode = "monophonic"

    # —— v3 关键改造：polyphonic 模式下若同时拿到了 vocals stem，
    # 就额外用 PYIN 抽一条权威旋律线，否则旋律根本听不出（用户原话）。 ——
    melody_notes_authoritative: list | None = None
    if (
        arrangement_mode == "polyphonic"
        and options.separationMode != "none"
        and "vocals" in (locals().get("stem_paths") or {})
    ):
        try:
            mel, _ = melody_extractor.extract(stem_paths["vocals"], bpm=bpm)
            if mel:
                melody_notes_authoritative = mel
                melody_algo = melody_algo + "+pyin_vocal_melody"
                logger.info(f"[stage] vocal melody (PYIN): {len(mel)} notes")
        except Exception as e:
            logger.warning(f"[melody] PYIN on vocals failed: {e}")

    # —— 单音模式：保留旧 skyline 行为 ——
    # 复音 Basic Pitch 输出多线条 → 在器乐扒主旋律时是"杂乱"的来源。
    # PYIN 本身已是单音，不必再压。
    if arrangement_mode == "monophonic" and not use_pyin:
        before = len(raw_notes)
        raw_notes = melody_picker.to_monophonic(raw_notes)
        logger.info(f"[stage] monophonic skyline: {before} → {len(raw_notes)} notes")
        melody_algo = "basic_pitch+skyline"

    # —— 和弦识别（polyphonic 模式必备 / monophonic 仅作元数据）——
    chord_segments: list[dict] = []
    if options.detectChords:
        # 和弦在「原始未移调」音频上识别更准；用整曲（含人声/伴奏） vs 选定 stem
        # 选: 优先用整曲（chord 信息在伴奏/和声更丰富）
        chord_audio = audio_path
        try:
            chord_segments, _beats = chord_detector.detect(chord_audio)
            logger.info(f"[stage] chord detection: {len(chord_segments)} segments")
        except Exception as e:
            logger.warning(f"[chord] detection failed: {e}")
            chord_segments = []

    key_info = key_detector.detect_key(raw_notes)
    logger.info(f"Detected key: {key_info}")

    # —— 移调策略 ——
    # 优先级：optimizePlayKey > transposeToC
    notes = raw_notes
    recommended_shift: Optional[int] = None
    playable_key: Optional[str] = None
    final_key_sig = key_info["key"]

    if options.optimizePlayKey:
        best = key_optimizer.find_best_shift(raw_notes)
        recommended_shift = int(best["shift"])
        notes = key_optimizer.apply_shift(raw_notes, recommended_shift)
        # 「玩家在游戏里把升降调键设为 +shift，键盘就是这个调」
        playable_key = PITCH_NAMES[(0 - recommended_shift) % 12]
        final_key_sig = playable_key
        logger.info(
            f"[stage] optimizePlayKey shift={recommended_shift:+d} "
            f"score={best['score']} detail={best['detail']} -> playable_key={playable_key}"
        )
        # 和弦同步移调
        if chord_segments:
            chord_segments = chord_detector.transpose_chords(chord_segments, recommended_shift)
    elif options.transposeToC:
        shift_to_c = key_info["transposeToC"]
        notes = sky_mapper.transpose(notes, shift_to_c)
        if chord_segments:
            chord_segments = chord_detector.transpose_chords(chord_segments, shift_to_c)
        final_key_sig = "C"

    # —— 15 键映射（按编配模式分支）——
    max_concurrent = 1
    if arrangement_mode == "polyphonic" and not use_pyin:
        # 同步移调 vocal melody（如果有）
        melody_for_voicing = melody_notes_authoritative
        if melody_for_voicing and recommended_shift is not None:
            melody_for_voicing = key_optimizer.apply_shift(melody_for_voicing, recommended_shift)
        elif melody_for_voicing and options.transposeToC:
            melody_for_voicing = sky_mapper.transpose(melody_for_voicing, key_info["transposeToC"])

        sky_notes, max_concurrent = sky_mapper.process_polyphonic(
            notes,
            bpm,
            chord_segments=chord_segments or None,
            melody_notes=melody_for_voicing,
            grid=options.quantizeGrid,
            max_simultaneous=options.maxSimultaneous,
        )
        logger.info(
            f"[stage] polyphonic voicing: notes={len(sky_notes)} "
            f"max_concurrent={max_concurrent} "
            f"melody_source={'vocal_pyin' if melody_for_voicing else 'top_of_poly'}"
        )
    else:
        sky_notes = sky_mapper.process(
            notes, bpm, simplify=options.simplifyMelody, grid=options.quantizeGrid
        )
        max_concurrent = 1
        arrangement_mode = "monophonic"  # 兜底标记

    duration = max((n["end"] for n in raw_notes), default=0.0)
    title = os.path.splitext(os.path.basename(audio_path))[0]

    score = CubyScore(
        meta=Meta(
            title=title,
            bpm=round(bpm, 2),
            keySignature=final_key_sig,
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
        melodyAlgo=melody_algo,
        arrangementMode=arrangement_mode,
        maxConcurrent=max_concurrent,
        chords=[
            ChordSegment(
                start=round(c["start"], 3),
                end=round(c["end"], 3),
                label=c["label"],
                root=c["root"],
                quality=c["quality"],
            )
            for c in (chord_segments or [])
        ] if chord_segments else None,
        recommendedShift=recommended_shift,
        playableKey=playable_key,
    )

    return {
        "cubyScore": score.model_dump(),
        "metadata": meta.model_dump(),
        "stems": [s.model_dump() for s in stems],
        "taskId": task_id,
    }
