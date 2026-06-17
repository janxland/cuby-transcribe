import { useEffect } from "react";
import { Music2 } from "lucide-react";
import { Uploader } from "./components/Uploader";
import { ProgressCard } from "./components/ProgressCard";
import { AudioPlayer } from "./components/AudioPlayer";
import { ScoreViewer } from "./components/ScoreViewer";
import { HeaderControls } from "./components/HeaderControls";
import { HumTranscribePanel } from "./components/recorder";
import { useStore } from "@/store";
import { setSynthVolume } from "@/components/synth";

export default function App() {
  // 启动时把已持久化的音量值套到合成器（master gain）
  const masterVolume = useStore((s) => s.masterVolume);
  useEffect(() => {
    setSynthVolume(masterVolume);
  }, [masterVolume]);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      {/* 顶栏 */}
      <header className="shrink-0 h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center px-5 gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
          <Music2 className="w-4 h-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <h1 className="text-sm font-semibold">Cuby Transcribe</h1>
          <p className="text-[10px] text-slate-400">AI 扒谱 · 光遇 15 键 · Demucs + Basic Pitch</p>
        </div>
        <HeaderControls />
        <span className="ml-3 text-[10px] text-slate-500 font-mono">v0.3 · workstation</span>
      </header>

      {/* 主体：左侧边栏 + 右编辑区，共同占满剩余视口 */}
      <main className="flex-1 flex overflow-hidden">
        <aside className="w-[340px] shrink-0 border-r border-slate-800 bg-slate-950/40 overflow-y-auto p-4 space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <HumTranscribePanel />
          </section>
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-xs font-medium text-slate-300 mb-3 uppercase tracking-wider">上传音频</h2>
            <Uploader />
          </section>
          <ProgressCard />
        </aside>

        <section className="flex-1 flex flex-col overflow-hidden">
          {/* 原音预听条（可选） */}
          <div className="shrink-0 border-b border-slate-800 bg-slate-950/40">
            <AudioPlayer />
          </div>
          {/* 编辑器主区，撑满剩余高度 */}
          <div className="flex-1 overflow-hidden p-3">
            <ScoreViewer />
          </div>
        </section>
      </main>
    </div>
  );
}
