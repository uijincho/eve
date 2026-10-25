// Light (Daylight) or dark (Lamplight) theme. The choice lives in this
// browser's localStorage; "system" follows the operating system. The resolved
// theme is data-theme on <html>, which app/globals.css keys its tokens on.
//
// No React here: the root layout (a Server Component) inlines THEME_SCRIPT.

export type ThemePreference = "light" | "dark" | "system";

const KEY = "eve-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs in <head> before first paint, so a dark preference never flashes light. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("${DARK_QUERY}").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;

let saved: ThemePreference | undefined;

export function readThemePreference(): ThemePreference {
  if (saved) return saved;
  try {
    const p = localStorage.getItem(KEY);
    saved = p === "light" || p === "dark" ? p : "system";
  } catch {
    saved = "system";
  }
  return saved;
}

/** Sets data-theme from a preference, and the browser chrome colour to match. */
export function applyTheme(pref: ThemePreference = readThemePreference()) {
  const dark = pref === "dark" || (pref === "system" && matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  const ground = getComputedStyle(root).getPropertyValue("--background").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", ground));
}

const listeners = new Set<() => void>();

export function setThemePreference(pref: ThemePreference) {
  saved = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Private windows may refuse storage; the choice still holds for this page.
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

/**
 * Notifies on any change to the preference or to what it resolves to: a
 * choice made here, in another tab, or a system switch while on "system".
 */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  const media = matchMedia(DARK_QUERY);
  const onSystem = () => {
    if (readThemePreference() === "system") applyTheme("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    saved = undefined;
    applyTheme();
    listener();
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}
