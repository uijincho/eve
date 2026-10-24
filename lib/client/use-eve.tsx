"use client";

// One data hook for every screen: a single snapshot from GET /api/app, a
// refresh after each action, and polling that speeds up to 2 s only while the
// agent feed is on screen or work is visibly in flight.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ActionResult, AppSnapshot } from "@/lib/contracts";

import { ApiError, getSnapshot, runAction, switchPersona } from "./api";
import { hasLiveWork } from "./derive";
import type { ActionCall } from "./payloads";

const FAST_MS = 2_000;
const SLOW_MS = 20_000;

type EveContext = {
  snapshot: AppSnapshot | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
  act: (call: ActionCall) => Promise<ActionResult>;
  setPersona: (personaId: string) => Promise<ActionResult>;
  /** Components that show live agent work register here to poll every 2 s. */
  watchLive: () => () => void;
};

const Ctx = createContext<EveContext | null>(null);

export function EveProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchers, setWatchers] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const p = getSnapshot()
      .then((s) => {
        setSnapshot(s);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e : new ApiError("Could not reach Eve.", 0));
      })
      .finally(() => {
        setLoading(false);
        inflight.current = null;
      });
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fast = watchers > 0 || hasLiveWork(snapshot);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, fast ? FAST_MS : SLOW_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fast, refresh]);

  const act = useCallback(
    async (call: ActionCall) => {
      const result = await runAction(call.action, call.payload);
      // Successful mutations return the fresh snapshot; use it instead of a second request.
      const fresh = result.data?.snapshot as AppSnapshot | undefined;
      if (fresh && typeof fresh === "object" && "actor" in fresh) {
        setSnapshot(fresh);
        setError(null);
        const { snapshot: _omit, ...rest } = result.data ?? {};
        void _omit;
        return { ...result, data: rest };
      }
      await refresh();
      return result;
    },
    [refresh],
  );

  const setPersona = useCallback(
    async (personaId: string) => {
      const result = await switchPersona(personaId);
      if (result.ok) await refresh();
      return result;
    },
    [refresh],
  );

  const watchLive = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);

  const value = useMemo(
    () => ({ snapshot, error, loading, refresh, act, setPersona, watchLive }),
    [snapshot, error, loading, refresh, act, setPersona, watchLive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEve(): EveContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEve must be used inside <EveProvider>");
  return ctx;
}

/** Polls every 2 s while the calling component is mounted. */
export function useLivePolling(enabled = true) {
  const { watchLive } = useEve();
  useEffect(() => (enabled ? watchLive() : undefined), [enabled, watchLive]);
}

export type ActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; result: ActionResult };

/** Runs one action with its own pending and result state. */
export function useAction() {
  const { act } = useEve();
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const run = useCallback(
    async (call: ActionCall) => {
      setState({ status: "pending" });
      const result = await act(call);
      setState({ status: "done", result });
      return result;
    },
    [act],
  );
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset, pending: state.status === "pending" };
}
