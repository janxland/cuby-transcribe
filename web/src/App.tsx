import { Music2 } from "lucide-react";
import { Uploader } from "./components/Uploader";
import { ProgressCard } from "./components/ProgressCard";
import { AudioPlayer } from "./components/AudioPlayer";
import { ScoreViewer } from "./components/ScoreViewer";

export default function App() {
  return (
    <div className="min-h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Music2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Cuby Transcribe</h1>
            <p className="text-xs text-slate-400">AI 扒谱 · 光遇 15 键 · Basic Pitch</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-4 space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-medium text-slate-300 mb-3">上传音频</h2>
            <Uploader />
          </section>
          <ProgressCard />
        </aside>

        <section className="lg:col-span-8 space-y-4">
          <AudioPlayer />
          <ScoreViewer />
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-6 text-center text-xs text-slate-500">
        Powered by Basic Pitch · React + Vite · Tailwind v4
      </footer>
    </div>
  );
}
