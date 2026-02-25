import { useSyncExternalStore } from 'react';

let now = Date.now();
let listeners: Set<() => void> = new Set();
let intervalId: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    intervalId = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };
}

function getSnapshot() {
  return now;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
