"""使用 Basic Pitch 把音频转为 MIDI 音符列表。"""
from __future__ import annotations

from typing import List, Tuple
from loguru import logger


def transcribe(audio_path: str) -> Tuple[List[dict], float]:
    """
    返回 (notes, bpm)。
    notes: [{pitch, start, end, velocity}, ...]
    """
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH

    logger.info(f"[transcribe] start: {audio_path}")
    model_output, midi_data, note_events = predict(audio_path, ICASSP_2022_MODEL_PATH)

    notes = []
    for start, end, pitch, velocity, _pitch_bends in note_events:
        if end <= start:
            continue
        notes.append({
            "pitch": int(pitch),
            "start": float(start),
            "end": float(end),
            "velocity": max(1, min(127, int(velocity * 127) if velocity <= 1 else int(velocity))),
        })

    # 估计 BPM
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo) if tempo else 120.0
    except Exception as e:
        logger.warning(f"BPM detection failed: {e}")
        bpm = 120.0

    logger.info(f"[transcribe] done: {len(notes)} notes, bpm={bpm:.1f}")
    notes.sort(key=lambda n: n["start"])
    return notes, bpm
