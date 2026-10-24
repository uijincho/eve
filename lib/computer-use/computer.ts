import { readFile } from "node:fs/promises";
import path from "node:path";

import { Sandbox } from "@e2b/desktop";

import { pageFromTitle, type PortalPage } from "./guards";
import { PORTAL_URL, PORTAL_USERNAME } from "./packet";

/** 1024×768 keeps clicks accurate and screenshots well under the model's image limits, so no scaling is needed. */
export const SCREEN = { width: 1024, height: 768 } as const;

const PORTAL_DIR = "/home/user/westbrook";
const RECORDS_PATH = `${PORTAL_DIR}/requests.json`;
const EVENTS_PATH = `${PORTAL_DIR}/events.json`;
const CHROME_POLICY = "/etc/opt/chrome/policies/managed/eve-lab.json";
// Firefox ESR in the E2B image never opens a window without internet access; Chrome opens in seconds.
const CHROME_FLAGS = [
  "--no-first-run", "--no-default-browser-check", "--password-store=basic", "--disable-sync",
  "--disable-background-networking", "--disable-component-update", "--no-pings",
  "--disable-features=Translate,MediaRouter,OptimizationHints",
  "--user-data-dir=/home/user/.eve-chrome", "--window-position=0,0", "--window-size=1024,768", "--start-maximized",
];
const SANDBOX_TIMEOUT_MS = 30 * 60_000;

export interface Computer {
  desktop: Sandbox;
  sandboxId: string;
  streamUrl: string;
  /** True when the sandbox was created with no outbound internet. */
  offline: boolean;
}

export interface BootOptions {
  strictSsn: boolean;
  password: string;
  documents: { path: string; bytes: Uint8Array }[];
  onProgress?: (message: string) => void;
  /** Called as soon as the sandbox exists, so a retried boot can delete an orphan. */
  onCreated?: (sandboxId: string) => Promise<void> | void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function run(desktop: Sandbox, command: string, opts: { user?: "root" | "user" } = {}) {
  try {
    const result = await desktop.commands.run(command, { envs: { DISPLAY: desktop.display }, user: opts.user, timeoutMs: 30_000 });
    return { ok: true, stdout: result.stdout.trim() };
  } catch (error) {
    // CommandExitError carries the output of a non-zero exit; anything else is a real failure.
    const failed = error as { stdout?: string; exitCode?: number };
    if (typeof failed.exitCode === "number") return { ok: false, stdout: (failed.stdout ?? "").trim() };
    throw error;
  }
}

/**
 * Starts a long-lived process outside the command's lifetime. E2B kills commands, background ones
 * included, after their 60-second timeout, which took down the portal and Chrome mid-run.
 */
async function detach(desktop: Sandbox, command: string, log: string, envs: Record<string, string>) {
  await desktop.commands.run(`setsid nohup ${command} > ${log} 2>&1 < /dev/null &`, { envs, timeoutMs: 15_000 });
}

function xdotool(desktop: Sandbox, ...args: (string | number)[]) {
  return run(desktop, ["xdotool", ...args.map((a) => shellQuote(String(a)))].join(" "));
}

async function until(check: () => Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/** Chrome managed policy: the browser can open the portal and nothing else, and never offers to save the password. */
async function lockBrowser(desktop: Sandbox) {
  const policy = {
    URLBlocklist: ["*"],
    URLAllowlist: [new URL(PORTAL_URL).origin],
    PasswordManagerEnabled: false,
    AutofillAddressEnabled: false,
    AutofillCreditCardEnabled: false,
    TranslateEnabled: false,
    BrowserSignin: 0,
    SyncDisabled: true,
    DefaultBrowserSettingEnabled: false,
    PromotionsEnabled: false,
    MetricsReportingEnabled: false,
    SearchSuggestEnabled: false,
  };
  await desktop.files.write(CHROME_POLICY, JSON.stringify(policy, null, 2), { user: "root" });
}

export async function bootComputer(opts: BootOptions): Promise<Computer> {
  const progress = opts.onProgress ?? (() => {});
  const offline = process.env.EVE_COMPUTER_USE_ALLOW_INTERNET !== "true";
  progress(offline ? "Creating an E2B desktop with no internet access" : "Creating an E2B desktop");
  const desktop = await Sandbox.create({
    resolution: [SCREEN.width, SCREEN.height],
    dpi: 96,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    allowInternetAccess: !offline,
    metadata: { purpose: "eve-computer-use-lab" },
  });
  try {
    await opts.onCreated?.(desktop.sandboxId);
    if (offline) {
      // Measure it rather than trust the flag: a raw IP skips DNS, so a pass here means no route out at all.
      progress("Checking the sandbox cannot reach the internet");
      const probe = await run(desktop, "curl -s -m 4 -o /dev/null -w '%{http_code}' http://1.1.1.1");
      if (probe.stdout !== "000") throw new Error(`The sandbox reached the internet (HTTP ${probe.stdout}) although it was created without internet access. Not continuing.`);
    }
    progress("Uploading the Westbrook portal and the packet documents");
    const portalSource = path.join(process.cwd(), "lab", "westbrook-portal");
    const [html, server] = await Promise.all([
      readFile(path.join(portalSource, "index.html"), "utf8"),
      readFile(path.join(portalSource, "server.py"), "utf8"),
    ]);
    await desktop.files.write([
      { path: `${PORTAL_DIR}/index.html`, data: html },
      { path: `${PORTAL_DIR}/server.py`, data: server },
      ...opts.documents.map((d) => ({ path: d.path, data: d.bytes.slice().buffer as ArrayBuffer })),
    ]);

    progress("Starting the portal on 127.0.0.1:8080 inside the sandbox");
    await detach(desktop, `python3 ${PORTAL_DIR}/server.py`, `${PORTAL_DIR}/server.log`, {
      PORTAL_PASSWORD: opts.password,
      PORTAL_USERNAME,
      PORTAL_STRICT_SSN: opts.strictSsn ? "1" : "0",
      PORTAL_RECORDS: RECORDS_PATH,
      PORTAL_EVENTS: EVENTS_PATH,
      PORTAL_PORT: new URL(PORTAL_URL).port,
    });
    await until(async () => (await run(desktop, `curl -s -o /dev/null -w '%{http_code}' ${PORTAL_URL}api/config`)).stdout === "200", 15_000, "the portal to start");

    progress("Locking Chrome to the portal address");
    await lockBrowser(desktop);
    await detach(desktop, `google-chrome ${CHROME_FLAGS.join(" ")} ${PORTAL_URL}`, "/home/user/chrome.log", { DISPLAY: desktop.display });
    await until(async () => (await windowTitle(desktop)) !== "", 60_000, "Chrome to open the portal");
    const id = (await xdotool(desktop, "search", "--onlyvisible", "--name", "Westbrook Finance")).stdout.split("\n")[0];
    if (id) await xdotool(desktop, "windowactivate", "--sync", id);
    await sleep(1500);

    progress("Starting the live view");
    await desktop.stream.start({ requireAuth: true });
    const streamUrl = desktop.stream.getUrl({ authKey: desktop.stream.getAuthKey(), viewOnly: true, resize: "scale", autoConnect: true });
    return { desktop, sandboxId: desktop.sandboxId, streamUrl, offline };
  } catch (error) {
    await desktop.kill().catch(() => {});
    throw error;
  }
}

/** The browser window title, or "" when the portal window is not open. Works while a file dialog has focus. */
export async function windowTitle(desktop: Sandbox): Promise<string> {
  const result = await run(desktop, `for w in $(xdotool search --onlyvisible --name 'Westbrook Finance' 2>/dev/null); do xdotool getwindowname "$w"; done | head -1`);
  return result.stdout;
}

export async function currentPage(desktop: Sandbox): Promise<{ page: PortalPage; title: string }> {
  const title = await windowTitle(desktop);
  return { page: pageFromTitle(title), title };
}

export async function capture(desktop: Sandbox): Promise<string> {
  const bytes = await desktop.screenshot();
  return Buffer.from(bytes).toString("base64");
}

const KEY_ALIASES: Record<string, string> = {
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", backspace: "BackSpace", del: "Delete", delete: "Delete",
  tab: "Tab", space: "space", up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End",
  pageup: "Page_Up", page_up: "Page_Up", pagedown: "Page_Down", page_down: "Page_Down",
  cmd: "super", command: "super", meta: "super", win: "super", super: "super", control: "ctrl", ctrl: "ctrl", alt: "alt", shift: "shift",
};

/** Converts a toolset key combo ("ctrl+l", "Return") into an xdotool keysym list, refusing anything odd. */
export function toKeysym(combo: string): string {
  const parts = combo.split("+").map((p) => p.trim());
  if (parts.some((p) => !/^[A-Za-z0-9_]+$/.test(p))) throw new Error(`Unsupported key "${combo}".`);
  return parts.map((p) => KEY_ALIASES[p.toLowerCase()] ?? p).join("+");
}

function coordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Coordinates must be two numbers.");
  return [Math.min(Math.max(Math.round(x), 0), SCREEN.width - 1), Math.min(Math.max(Math.round(y), 0), SCREEN.height - 1)];
}

function modifiers(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return toKeysym(value).split("+");
}

async function clickWith(desktop: Sandbox, input: Record<string, unknown>, button: number, repeat: number) {
  const at = coordinate(input.coordinate);
  const mods = modifiers(input.text);
  const args: (string | number)[] = [];
  if (at) args.push("mousemove", at[0], at[1]);
  for (const m of mods) args.push("keydown", m);
  args.push("click", "--repeat", repeat, "--delay", 80, button);
  for (const m of mods.reverse()) args.push("keyup", m);
  const result = await xdotool(desktop, ...args);
  if (!result.ok) throw new Error("The click could not be performed.");
}

/**
 * Runs one computer toolset member on the desktop. Returns the text result for the model;
 * screenshots are taken by the caller. Throws on anything the desktop cannot do.
 */
export async function perform(desktop: Sandbox, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "screenshot":
      return "OK";
    case "left_click": await clickWith(desktop, input, 1, 1); return "OK";
    case "middle_click": await clickWith(desktop, input, 2, 1); return "OK";
    case "right_click": await clickWith(desktop, input, 3, 1); return "OK";
    case "double_click": await clickWith(desktop, input, 1, 2); return "OK";
    case "triple_click": await clickWith(desktop, input, 1, 3); return "OK";
    case "left_click_drag": {
      const from = coordinate(input.start_coordinate);
      const to = coordinate(input.coordinate);
      if (!from || !to) throw new Error("A drag needs start_coordinate and coordinate.");
      await desktop.drag(from, to);
      return "OK";
    }
    case "mouse_move": {
      const at = coordinate(input.coordinate);
      if (!at) throw new Error("mouse_move needs a coordinate.");
      await desktop.moveMouse(at[0], at[1]);
      return "OK";
    }
    case "left_mouse_down": await desktop.mousePress("left"); return "OK";
    case "left_mouse_up": await desktop.mouseRelease("left"); return "OK";
    case "cursor_position": {
      const { x, y } = await desktop.getCursorPosition();
      return `X=${x}, Y=${y}`;
    }
    case "scroll": {
      const at = coordinate(input.coordinate);
      if (at) await desktop.moveMouse(at[0], at[1]);
      const amount = Math.min(Math.max(Number(input.scroll_amount ?? 3), 1), 20);
      const direction = String(input.scroll_direction);
      const mods = modifiers(input.text);
      const button = { up: 4, down: 5, left: 6, right: 7 }[direction];
      if (!button) throw new Error(`Unknown scroll direction "${direction}".`);
      const args: (string | number)[] = [];
      for (const m of mods) args.push("keydown", m);
      args.push("click", "--repeat", amount, "--delay", 40, button);
      for (const m of mods.reverse()) args.push("keyup", m);
      await xdotool(desktop, ...args);
      return "OK";
    }
    case "type": {
      if (typeof input.text !== "string") throw new Error("type needs text.");
      await desktop.write(input.text, { chunkSize: 40, delayInMs: 30 });
      return "OK";
    }
    case "key": {
      const repeat = Math.min(Math.max(Number(input.repeat ?? 1), 1), 100);
      const result = await xdotool(desktop, "key", "--repeat", repeat, "--delay", 60, toKeysym(String(input.text ?? "")));
      if (!result.ok) throw new Error(`Key "${String(input.text)}" could not be pressed.`);
      return "OK";
    }
    case "hold_key": {
      const keys = toKeysym(String(input.text ?? ""));
      const seconds = Math.min(Math.max(Number(input.duration ?? 1), 0), 10);
      await xdotool(desktop, "keydown", keys);
      await sleep(seconds * 1000);
      await xdotool(desktop, "keyup", keys);
      return "OK";
    }
    case "wait": {
      await sleep(Math.min(Math.max(Number(input.duration ?? 1), 0), 10) * 1000);
      return "OK";
    }
    default:
      throw new Error(`The ${name} action is not available on this computer.`);
  }
}

/** Types the portal password with xdotool. The value comes from the lab session, never from the model. */
export async function typeSecret(desktop: Sandbox, secret: string) {
  await desktop.write(secret, { chunkSize: 40, delayInMs: 30 });
}

export interface PortalEvent { type: string; detail: string; at: string }

async function readJson<T>(desktop: Sandbox, file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await desktop.files.read(file)) as T; } catch { return fallback; }
}

/** What the portal itself recorded: page views, validation errors and submissions. */
export function portalEvents(desktop: Sandbox) {
  return readJson<PortalEvent[]>(desktop, EVENTS_PATH, []);
}

export function portalRecords(desktop: Sandbox) {
  return readJson<Record<string, unknown>[]>(desktop, RECORDS_PATH, []);
}
