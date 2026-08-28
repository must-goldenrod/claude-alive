import { useEffect, useState } from 'react';

interface ResourceState<T> {
  sessionId: string | null;
  value: T | null;
  status: 'idle' | 'loading' | 'ready' | 'empty';
}

type SessionLoader<T> = (sessionId: string, signal: AbortSignal) => Promise<T | null>;

export function useSessionResource<T>(
  sessionId: string | null,
  load: SessionLoader<T>,
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({
    sessionId: null,
    value: null,
    status: 'idle',
  });

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const controller = new AbortController();
    setState({ sessionId, value: null, status: 'loading' });

    void load(sessionId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          sessionId,
          value,
          status: value === null ? 'empty' : 'ready',
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ sessionId, value: null, status: 'empty' });
        }
      });

    return () => {
      controller.abort();
    };
  }, [load, sessionId]);

  if (state.sessionId !== sessionId) {
    return {
      sessionId,
      value: null,
      status: sessionId ? 'loading' : 'idle',
    };
  }

  return state;
}
