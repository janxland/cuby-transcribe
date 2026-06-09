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
    raw_transcriber,
)

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# v3：90 太严，Basic Pitch 输出 velocity 多在 60-90 之间 —— 几乎全被分到 Chord 轨，
# Melody 轨变空，触发空轨 fallback → 所有音塞进单 Melody → 与 爱扒谱 对比一片单声部。
MELODY_VELOCITY_FLOOR = 75


STEMS_ROOT = os.environ.get("STEMS_DIR", "/tmp/cuby-stems")
os.makedirs(STEMS_ROOT, exist_ok=True)


def _duration(path: str) -> float:
    try:
        import librosa
        return float(librosa.get_duration(path=path))
    except Exception:
        return 0.0


def _to_score_note(n: dict) -> Note:
    return Note(
        pitch=n["pitch"],
        time=round(n["start"], 4),
        duration=round(n["end"] - n["start"], 4),
        velocity=n.get("velocity", 90),
    )


def _build_tracks(notes: list[dict], arrangement_mode: str) -> list[Track]:
    if arrangement_mode != "polyphonic":
        return [
            Track(
                id="track_1",
                name="Melody",
                instrument="Grand Piano",
                notes=[_to_score_note(n) for n in notes],
            )
        ]

    melody_notes = [n for n in notes if n.get("velocity", 90) >= MELODY_VELOCITY_FLOOR]
    chord_notes = [n for n in notes if n.get("velocity", 90) < MELODY_VELOCITY_FLOOR]

    # v3：velocity 分轨失败时改用 **音高分轨** —— 高音→Melody，低音→Chord。
    # 原实现在分轨失败时把所有音塞进 Melody、Chord 留空 → 输出退化成单声部。
    if not melody_notes or not chord_notes:
        if len(notes) >= 4:
            pitches = sorted(n["pitch"] for n in notes)
            split_pitch = pitches[len(pitches) // 2]  # 中位音高
            melody_notes = [n for n in notes if n["pitch"] >= split_pitch]
            chord_notes = [n for n in notes if n["pitch"] < split_pitch]
            if melody_notes and chord_notes:
                return [
                    Track(id="track_1", name="Melody", instrument="Grand Piano",
                          notes=[_to_score_note(n) for n in melody_notes]),
                    Track(id="track_2", name="Chord", instrument="Grand Piano",
                          notes=[_to_score_note(n) for n in chord_notes]),
                ]
        return [
            Track(
                id="track_1",
                name="Melody",
                instrument="Grand Piano",
                notes=[_to_score_note(n) for n in notes],
            ),
            Track(
                id="track_2",
                name="Chord",
                instrument="Grand Piano",
                notes=[],
            ),
        ]

    return [
        Track(
            id="track_1",
            name="Melody",
            instrument="Grand Piano",
            notes=[_to_score_note(n) for n in melody_notes],
        ),
        Track(
            id="track_2",
            name="Chord",
            instrument="Grand Piano",
            notes=[_to_score_note(n) for n in chord_notes],
        ),
    ]


def run(audio_path: str, options: ProcessOptions, task_id: str | None = None) -> dict:
    t0 = time.time()
    if not os.path.exists(audio_path):
        raise FileNotFoundError(audio_path)

    task_id = task_id or uuid.uuid4().hex[:8]
    stems_dir = os.path.join(STEMS_ROOT, task_id)
    stems: list[StemInfo] = []

    # ════════════════════════════════════════════════════════════════
    # v4 · 100% 保真扒谱分支
    # ════════════════════════════════════════════════════════════════
    # 默认走这条路径；产出 88 键全音域多 track MIDI，零驯化。
    # 光遇 15/25 键映射 / 移调 / voicing 全部由前端 editor 自行决定。
    if options.fidelityMode == "raw":
        return _run_raw(audio_path, options, task_id, stems_dir, t0)
    # ════════════════════════════════════════════════════════════════

    audio_for_transcribe = audio_path
    # 「这次扒的是哪条 stem」由 options.transcribeStem 权威决定；
    # 无分离 + 未指定 → 视为原曲。分离流程下若实际找到对应 stem 会再次确认。
    transcribed_stem = options.transcribeStem or "original"

    # BPM：优先用户手动值；否则从原曲检测，并在后续按音符分布自动纠偏。
    manual_bpm = float(options.manualBpm) if options.manualBpm and options.manualBpm > 0 else None
    bpm_source = "user" if manual_bpm is not None else "detected"
    bpm_future: Optional[Future] = None
    if manual_bpm is None:
        bpm_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bpm")
        bpm_future = bpm_pool.submit(transcriber.detect_bpm, audio_path)
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
            quality=options.separationQuality,
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
    if manual_bpm is not None:
        precomputed_bpm: Optional[float] = manual_bpm
    else:
        try:
            precomputed_bpm = bpm_future.result(timeout=30) if bpm_future else None
        except Exception as e:
            logger.warning(f"[bpm] future failed: {e}")
            precomputed_bpm = None

    # —— 选择旋律提取算法 ——
    # melodyMode='vocal' 且当前扒的是人声轨 → 走 PYIN 单音；否则回退 Basic Pitch
    # auto 模式下只要目标 stem 是 vocals，也强制走 PYIN。
    # Basic Pitch 对人声容易产出泛音碎片；这会直接把 editor 里的谱子打乱。
    use_pyin = transcribed_stem == "vocals" and options.melodyMode in {"auto", "vocal"}
    melody_algo = "pyin" if use_pyin else "basic_pitch"
    logger.info(f"[stage] transcribe ({transcribed_stem}) algo={melody_algo} bpm={precomputed_bpm}")
    if use_pyin:
        raw_notes, bpm = melody_extractor.extract(audio_for_transcribe, bpm=precomputed_bpm)
    else:
        raw_notes, bpm = transcriber.transcribe(audio_for_transcribe, bpm=precomputed_bpm)
    if not raw_notes:
        raise RuntimeError("No notes detected from audio")

    if manual_bpm is None:
        bpm, bpm_source = transcriber.refine_bpm_from_notes(bpm, raw_notes)

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
    beat_times: list[float] = []  # 真实 beat 位置，用于节奏量化吸附
    if options.detectChords:
        # 和弦在「原始未移调」音频上识别更准；用整曲（含人声/伴奏） vs 选定 stem
        # 选: 优先用整曲（chord 信息在伴奏/和声更丰富）
        chord_audio = audio_path
        try:
            chord_segments, beat_times = chord_detector.detect(chord_audio)
            logger.info(f"[stage] chord detection: {len(chord_segments)} segments, {len(beat_times)} beats")
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

    # —— 25 键映射（按编配模式分支，C4-C6 全半音阶）——
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
            notes, bpm, simplify=options.simplifyMelody, grid=options.quantizeGrid,
            beat_times=beat_times or None,
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
        tracks=_build_tracks(sky_notes, arrangement_mode),
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
        tempoSource=bpm_source,
    )

    return {
        "cubyScore": score.model_dump(),
        "metadata": meta.model_dump(),
        "stems": [s.model_dump() for s in stems],
        "taskId": task_id,
    }


# ══════════════════════════════════════════════════════════════════
# v4 · 100% 保真分支实现
# ══════════════════════════════════════════════════════════════════

def _run_raw(
    audio_path: str,
    options: ProcessOptions,
    task_id: str,
    stems_dir: str,
    t0: float,
) -> dict:
    """高保真多 stem 多乐器扒谱：零驯化，全音域，多 track 输出。

    流程：
      1. (可选) Demucs 分离 —— 默认强制 6stems 以获得 piano/guitar 单独 stem
      2. BPM 后台并行测算（仅作元数据，不参与量化）
      3. 每条 stem 用最佳算法独立转录（vocals→PYIN，余→Basic Pitch）
      4. 直接拼接为多 track CubyScore 返回，pitch/timing **完全保真**
    """
    stems: list[StemInfo] = []

    # —— 1. BPM：优先用户手动值；否则并行测算（仅元数据用） ——
    manual_bpm = float(options.manualBpm) if options.manualBpm and options.manualBpm > 0 else None
    bpm_source = "user" if manual_bpm is not None else "detected"
    bpm_future: Optional[Future] = None
    if manual_bpm is None:
        bpm_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bpm-raw")
        bpm_future = bpm_pool.submit(transcriber.detect_bpm, audio_path)
        bpm_pool.shutdown(wait=False)

    # —— 2. 分离（raw 默认仍尊重用户的 separationMode）——
    stem_paths: dict[str, str] = {}
    if options.separationMode != "none":
        from . import separator
        keep = list(options.stems) if options.stems else None
        logger.info(f"[raw] separation mode={options.separationMode} keep={keep}")
        stem_paths = separator.separate(
            audio_path, stems_dir, mode=options.separationMode, keep_stems=keep,
            quality=options.separationQuality,
        )
        for name, path in stem_paths.items():
            stems.append(StemInfo(
                name=name,
                url=f"/internal/stems/{task_id}/{name}.wav",
                duration=_duration(path),
            ))

    # —— 3. BPM 等回 ——
    if manual_bpm is not None:
        bpm = manual_bpm
    else:
        try:
            bpm = bpm_future.result(timeout=30) if bpm_future else 120.0
            bpm = float(bpm or 120.0)
        except Exception as e:
            logger.warning(f"[raw] bpm failed: {e}")
            bpm = 120.0

    # —— 4. 转录 ——
    recommended_shift: Optional[int] = None
    playable_key: Optional[str] = None

    if stem_paths:
        # 多 stem：每条独立转录
        melody_backend = "crepe" if options.separationQuality == "high" else "pyin"
        # 人声细节增强：高质量模式保留更短音、减少合并，尽量“全扒下来”
        vocal_min_note_sec = 0.04 if options.separationQuality == "high" else 0.08
        vocal_merge_gap_sec = 0.03 if options.separationQuality == "high" else 0.06
        vocal_voiced_thresh = 0.48 if options.separationQuality == "high" else 0.58
        tracks_data, algos = raw_transcriber.transcribe_stems(
            stem_paths,
            bpm=bpm,
            melody_backend=melody_backend,
            vocal_min_note_sec=vocal_min_note_sec,
            vocal_merge_gap_sec=vocal_merge_gap_sec,
            vocal_voiced_thresh=vocal_voiced_thresh,
        )
        tracks_data, algos = raw_transcriber.split_two_hand_tracks(tracks_data, algos)
        if not tracks_data:
            # 所有 stem 都失败 → 退回整曲转录
            logger.warning("[raw] all stems empty, fall back to full mix")
            full_notes = raw_transcriber.transcribe_single(audio_path, bpm=bpm)
            tracks_data = [{
                "id": "track_1",
                "name": "original",
                "instrument": "Full Mix",
                "notes": [raw_transcriber._to_score_note(n) for n in full_notes],
            }]
            algos = {"original": "basic_pitch"}
    else:
        # 不分离：整曲 Basic Pitch 复音保真
        full_notes = raw_transcriber.transcribe_single(audio_path, bpm=bpm)
        tracks_data = [{
            "id": "track_1",
            "name": "original",
            "instrument": "Full Mix",
            "notes": [raw_transcriber._to_score_note(n) for n in full_notes],
        }]
        algos = {"original": "basic_pitch"}
        tracks_data, algos = raw_transcriber.split_two_hand_tracks(tracks_data, algos)

    # —— 4.5 人声目标可演奏化：转到 25 键范围（默认开启）——
    if options.vocalToSky25 and options.transcribeStem == "vocals":
        for tr in tracks_data:
            if tr.get("name") != "vocals" or not tr.get("notes"):
                continue
            vocal_raw = [
                {
                    "pitch": n["pitch"],
                    "start": n["time"],
                    "end": n["time"] + n["duration"],
                    "velocity": n.get("velocity", 90),
                }
                for n in tr["notes"]
            ]
            best = key_optimizer.find_best_shift(vocal_raw)
            recommended_shift = int(best["shift"])
            shifted = key_optimizer.apply_shift(vocal_raw, recommended_shift)
            playable = sky_mapper.adapt_range(shifted)
            tr["notes"] = [raw_transcriber._to_score_note(n) for n in playable]
            playable_key = PITCH_NAMES[(0 - recommended_shift) % 12]
            logger.info(
                f"[raw] vocals -> sky25 shift={recommended_shift:+d} playable_key={playable_key} notes={len(tr['notes'])}"
            )
            break

    # —— 5. 调性识别（**仅作元数据**，不参与移调）——
    all_notes = [n for tr in tracks_data for n in tr["notes"]]
    detected_key = "C"
    detected_mode = "major"
    if all_notes:
        # key_detector 接收 raw 形式 {pitch,start,end}
        key_input = [{
            "pitch": n["pitch"],
            "start": n["time"],
            "end": n["time"] + n["duration"],
        } for n in all_notes]
        try:
            kinfo = key_detector.detect_key(key_input)
            detected_key = kinfo["key"]
            detected_mode = kinfo["mode"]
        except Exception as e:
            logger.warning(f"[raw] key detection failed: {e}")

    duration = max((n["time"] + n["duration"] for n in all_notes), default=0.0)
    note_count = len(all_notes)
    if manual_bpm is None and all_notes:
        refine_input = [
            {
                "pitch": n["pitch"],
                "start": n["time"],
                "end": n["time"] + n["duration"],
            }
            for n in all_notes
        ]
        bpm, bpm_source = transcriber.refine_bpm_from_notes(bpm, refine_input)

    title = os.path.splitext(os.path.basename(audio_path))[0]

    score = CubyScore(
        meta=Meta(
            title=title,
            bpm=round(bpm, 2),
            keySignature=detected_key,
        ),
        tracks=[
            Track(
                id=tr["id"],
                name=tr["name"],
                instrument=tr["instrument"],
                notes=[Note(**n) for n in tr["notes"]],
            )
            for tr in tracks_data
        ],
    )

    meta = Metadata(
        detectedKey=detected_key,
        detectedMode=detected_mode,
        bpm=round(bpm, 2),
        duration=round(duration, 2),
        noteCount=note_count,
        elapsed=round(time.time() - t0, 2),
        transcribedStem="multi" if len(tracks_data) > 1 else (tracks_data[0]["name"] if tracks_data else "original"),
        melodyAlgo="raw_multi_stem",
        arrangementMode="polyphonic",
        maxConcurrent=0,  # raw 不限制
        chords=None,
        recommendedShift=recommended_shift,
        playableKey=playable_key,
        fidelityMode="raw",
        perStemAlgo=algos or None,
        tempoSource=bpm_source,
    )

    return {
        "cubyScore": score.model_dump(),
        "metadata": meta.model_dump(),
        "stems": [s.model_dump() for s in stems],
        "taskId": task_id,
    }
