import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  /** 组件名称，便于报错时定位 */
  name?: string;
  children: React.ReactNode;
  /** 自定义降级 UI */
  fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // 控制台保留完整堆栈，便于排查
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.name ?? "anon"}]`, err, info.componentStack);
  }

  private reset = () => this.setState({ err: null });

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);
    return (
      <div className="rounded-xl border border-rose-700/60 bg-rose-950/40 p-4 text-sm">
        <div className="flex items-center gap-2 mb-2 text-rose-300">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-semibold">
            组件渲染异常{this.props.name ? `（${this.props.name}）` : ""}
          </span>
        </div>
        <pre className="text-[11px] text-rose-200/80 whitespace-pre-wrap break-all max-h-40 overflow-auto">
          {err.message}
        </pre>
        <button
          onClick={this.reset}
          className="mt-3 px-2.5 py-1 rounded bg-rose-700/40 hover:bg-rose-700/60 text-rose-100 text-xs flex items-center gap-1"
        >
          <RotateCw className="w-3 h-3" /> 重试
        </button>
      </div>
    );
  }
}
