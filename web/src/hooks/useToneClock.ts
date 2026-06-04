import { useSyncExternalStore } from "react";
import { toneClock, type ToneClockState } from "@/utils/toneClock";

/** 订阅 toneClock 状态变化，组件每帧得到最新 time/playing */
export function useToneClockState(): ToneClockState {
  return useSyncExternalStore(
    (cb) => toneClock.subscribe(cb),
    () => toneClock.getState(),
    () => toneClock.getState(),
  );
}
