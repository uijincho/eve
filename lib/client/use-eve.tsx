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

import { useRouter } from "next/navigation";

import type { ActionResult, AppSnapshot } from "@/lib/contracts";

import { ResultText } from "@/components/app/result-text";

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
  /** Shows a server answer whose button is gone (the state it changed removed it). */
  announce: (result: ActionResult) => void;
};

const Ctx = createContext<EveContext | null>(null);

export function EveProvider({
  children,
  guard = true,
}: {
  children: React.ReactNode;
  /** Send signed-out visitors to /login and accounts without an organization to /onboarding. */
  guard?: boolean;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchers, setWatchers] = useState(0);
  const [notice, setNotice] = useState<{ result: ActionResult; key: number } | null>(null);
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

  useEffect(() => {
    if (!guard || !error) return;
    if (error.code === "setup_required") router.replace("/onboarding");
    else if (error.code === "unauthenticated" || error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [guard, error, router]);

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

  const announce = useCallback((result: ActionResult) => setNotice({ result, key: Date.now() }), []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 8_000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const value = useMemo(
    () => ({ snapshot, error, loading, refresh, act, setPersona, watchLive, announce }),
    [snapshot, error, loading, refresh, act, setPersona, watchLive, announce],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <Announcer notice={notice?.result ?? null} onDismiss={() => setNotice(null)} />
    </Ctx.Provider>
  );
}

function Announcer({ notice, onDismiss }: { notice: ActionResult | null; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      {notice ? (
        <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-surface-hover px-3 py-2 text-small shadow-[0_10px_15px_-3px_rgb(0_0_0/0.3),0_4px_6px_-4px_rgb(0_0_0/0.3)] ring-1 ring-border">
          <ResultText result={notice} />
          <button type="button" onClick={onDismiss} className="ml-auto rounded-md px-1 text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
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
  const { act, announce } = useEve();
  const [state, setState] = useState<ActionState>({ status: "idle" });
  // The fresh snapshot often removes the control that asked (a released
  // payout has no Release button). If that happens right after the answer
  // arrives, hand it to the page-level announcer so it is not lost.
  const fresh = useRef<{ result: ActionResult; at: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const f = fresh.current;
      if (f && Date.now() - f.at < 3_000) announce(f.result);
    };
  }, [announce]);
  const run = useCallback(
    async (call: ActionCall) => {
      setState({ status: "pending" });
      const result = await act(call);
      if (!mounted.current) {
        announce(result);
        return result;
      }
      fresh.current = { result, at: Date.now() };
      setState({ status: "done", result });
      return result;
    },
    [act, announce],
  );
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset, pending: state.status === "pending" };
}
