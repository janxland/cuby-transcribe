import type { UploadOptions } from "@/types";
import type { RecorderTranscribeMode } from "./types";

export function createHummingOptions(
  playableRange: boolean,
  mode: RecorderTranscribeMode,
): Partial<UploadOptions> {
  if (mode === "instrument") {
    return {
      fidelityMode: "raw",
      separationQuality: "high",
      separationMode: "none",
      stems: [],
      transcribeStem: "original",
      melodyMode: "auto",
      arrangementMode: "polyphonic",
      forceMonophonic: false,
      detectChords: false,
      maxSimultaneous: 4,
      transposeToC: false,
      simplifyMelody: false,
      quantizeGrid: 16,
      vocalToSky25: false,
      optimizePlayKey: false,
    };
  }

  return {
    fidelityMode: "arranged",
    separationQuality: "fast",
    separationMode: "none",
    stems: [],
    transcribeStem: "vocals",
    melodyMode: "vocal",
    arrangementMode: "monophonic",
    forceMonophonic: true,
    detectChords: false,
    maxSimultaneous: 1,
    transposeToC: false,
    simplifyMelody: false,
    quantizeGrid: 16,
    vocalToSky25: playableRange,
    optimizePlayKey: playableRange,
  };
}
