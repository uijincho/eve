"use client";

import { cn } from "cn";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useId, useLayoutEffect, useSyncExternalStore } from "react";

import {
  THEME_SCRIPT,
  applyTheme,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from "@/lib/client/theme";

export const THEME_OPTIONS: { id: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "system", label: "System", Icon: MonitorIcon },
];

/** Null while server-rendered: the saved choice is only known in the browser. */
export function useThemePreference(): ThemePreference | null {
  return useSyncExternalStore(subscribeTheme, readThemePreference, () => null);
}

/**
 * The head script that sets the theme before first paint. It runs from the
 * server HTML only; on the client it renders as text/plain so React does not
 * warn about a script it would never execute.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}

/**
 * Mounted once in the root layout. The head script sets the theme before
 * paint; this keeps it in step afterwards: with the OS while on "system", with
 * other tabs, and after React's development remount resets <html>.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    return subscribeTheme(() => {});
  }, []);
  return null;
}

/** Light, Dark or System, as a segmented control. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const pref = useThemePreference();
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span id={id} className="text-caption text-faint">
        Theme
      </span>
      <div role="group" aria-labelledby={id} className="flex gap-0.5 rounded-lg bg-surface-hover p-0.5">
        {THEME_OPTIONS.map(({ id: option, label, Icon }) => (
          <button
            key={option}
            type="button"
            aria-pressed={pref === option}
            onClick={() => setThemePreference(option)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-caption transition-colors duration-150",
              pref === option
                ? "bg-surface font-semibold text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
