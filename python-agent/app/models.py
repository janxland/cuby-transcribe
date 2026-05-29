from pydantic import BaseModel, Field
from typing import List, Literal, Optional


class ProcessOptions(BaseModel):
    target: Literal["vocal", "instrument", "auto"] = "auto"
    transposeToC: bool = True
    quantizeGrid: Literal[8, 16] = 16
    simplifyMelody: bool = True


class ProcessRequest(BaseModel):
    audioPath: str
    options: ProcessOptions = Field(default_factory=ProcessOptions)


class Note(BaseModel):
    pitch: int          # MIDI pitch
    time: float         # seconds
    duration: float     # seconds
    velocity: int = 90


class Track(BaseModel):
    id: str
    name: str
    instrument: str
    notes: List[Note]


class Meta(BaseModel):
    title: str = "Untitled"
    composer: str = "AI Transcribed"
    bpm: float = 120.0
    timeSignature: str = "4/4"
    keySignature: str = "C"
    ppq: int = 480


class CubyScore(BaseModel):
    version: str = "1.1"
    meta: Meta
    tracks: List[Track]


class Metadata(BaseModel):
    detectedKey: str
    detectedMode: str
    bpm: float
    duration: float
    noteCount: int
    elapsed: float


class ProcessResponse(BaseModel):
    success: bool
    cubyScore: Optional[CubyScore] = None
    metadata: Optional[Metadata] = None
    error: Optional[str] = None
