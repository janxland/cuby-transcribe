from pydantic import BaseModel, Field
from typing import List, Literal, Optional


SeparationMode = Literal["none", "vocals", "4stems", "6stems"]
TranscribeStem = Literal[
    "original", "vocals", "no_vocals", "drums", "bass", "other", "piano", "guitar",
]


class ProcessOptions(BaseModel):
    transposeToC: bool = True
    quantizeGrid: Literal[8, 16] = 16
    simplifyMelody: bool = True

    # 音轨分离（Demucs）
    separationMode: SeparationMode = "none"
    # 要扒哪条音轨；为 None 时根据 separationMode 自动决定
    transcribeStem: Optional[TranscribeStem] = None
    # 用户实际想要保留的 stems 名单；为 None 时保留全部 demucs 输出
    stems: Optional[List[str]] = None


class ProcessRequest(BaseModel):
    audioPath: str
    options: ProcessOptions = Field(default_factory=ProcessOptions)
    taskId: Optional[str] = None


class Note(BaseModel):
    pitch: int
    time: float
    duration: float
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


class StemInfo(BaseModel):
    name: str
    url: str
    duration: float


class Metadata(BaseModel):
    detectedKey: str
    detectedMode: str
    bpm: float
    duration: float
    noteCount: int
    elapsed: float
    transcribedStem: str


class ProcessResponse(BaseModel):
    success: bool
    cubyScore: Optional[CubyScore] = None
    metadata: Optional[Metadata] = None
    stems: List[StemInfo] = Field(default_factory=list)
    taskId: Optional[str] = None
    error: Optional[str] = None
