"use client";

import { Menu } from "@base-ui/react/menu";
import { cn } from "cn";
import { CheckIcon, ChevronsUpDownIcon, LoaderCircleIcon, LogOutIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ResultText } from "@/components/app/result-text";
import { THEME_OPTIONS, useThemePreference } from "@/components/app/theme-switcher";
import type { ActionResult, Role } from "@/lib/contracts";
import { auth } from "@/lib/client/account";
import { ROLE_LABEL, initials } from "@/lib/client/format";
import { setThemePreference, type ThemePreference } from "@/lib/client/theme";
import { useEve } from "@/lib/client/use-eve";

const ROLES: Role[] = ["organizer", "controller", "auditor", "attendee"];

const ITEM =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-small outline-none select-none data-highlighted:bg-surface-hover";

/**
 * The signed-in person as one button. Clicking it opens the demo persona
 * switcher (or Sign out for a real account) and the theme control. The server
 * still decides what a persona may do.
 */
export function AccountMenu({ variant = "rail", className }: { variant?: "rail" | "bar"; className?: string }) {
  const { snapshot, setPersona } = useEve();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useThemePreference();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  if (!snapshot) return null;
  const { actor, personas } = snapshot;
  const switching = snapshot.demo && personas.length > 1;
  const rail = variant === "rail";

  async function choose(id: string) {
    const next = personas.find((p) => p.id === id);
    if (!next || next.id === actor.id) return;
    setPending(true);
    const r = await setPersona(next.id);
    setPending(false);
    setResult(r.ok ? null : r);
    if (!r.ok) return;
    const inPortal = pathname.startsWith("/portal");
    if (next.role === "attendee" && !inPortal) router.push("/portal");
    if (next.role !== "attendee" && inPortal) router.push("/overview");
  }

  return (
    <div className={cn("flex flex-col gap-1.5", rail ? "w-full" : "ml-auto", className)}>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`${actor.name}, ${ROLE_LABEL[actor.role]}. ${switching ? "Switch persona or theme" : "Account and theme"}`}
          className={cn(
            "flex items-center gap-2.5 rounded-xl text-left outline-none transition-colors duration-150 hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-surface-hover",
            rail ? "w-full p-2" : "px-1.5 py-1",
          )}
        >
          <Avatar name={actor.name} className={rail ? "size-8" : "size-7"} />
          <span className={cn("flex min-w-0 flex-1 flex-col", !rail && "max-sm:hidden")}>
            <span className="truncate text-small font-semibold">{actor.name}</span>
            {rail ? <span className="truncate text-caption text-muted-foreground">{ROLE_LABEL[actor.role]}</span> : null}
          </span>
          {pending ? (
            <LoaderCircleIcon aria-label="Switching" className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : rail ? (
            <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side={rail ? "top" : "bottom"} align={rail ? "start" : "end"} sideOffset={6} className="z-50 outline-none">
            <Menu.Popup className="flex w-64 origin-(--transform-origin) flex-col rounded-xl bg-popover p-1 text-popover-foreground shadow-lg shadow-black/10 ring-1 ring-border outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              {switching ? (
                <Menu.RadioGroup value={actor.id} onValueChange={(id: string) => void choose(id)}>
                  <Menu.GroupLabel className="px-2 pt-1.5 pb-1 text-caption text-faint">Switch persona</Menu.GroupLabel>
                  {ROLES.flatMap((role) => personas.filter((p) => p.role === role)).map((p) => (
                    <Menu.RadioItem key={p.id} value={p.id} closeOnClick className={ITEM}>
                      <Avatar name={p.name} className="size-6" />
                      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="shrink-0 text-caption text-muted-foreground">{ROLE_LABEL[p.role]}</span>
                      </span>
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <Menu.RadioItemIndicator>
                          <CheckIcon aria-hidden className="size-4" />
                        </Menu.RadioItemIndicator>
                      </span>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              ) : (
                <>
                  <div className="flex flex-col px-2 pt-1.5 pb-1">
                    <span className="truncate text-small font-semibold">{actor.name}</span>
                    <span className="truncate text-caption text-muted-foreground">{actor.email}</span>
                  </div>
                  <Menu.Item
                    className={ITEM}
                    onClick={async () => {
                      await auth.signOut().catch(() => null);
                      router.replace("/login");
                    }}
                  >
                    <LogOutIcon aria-hidden className="size-4 text-muted-foreground" />
                    Sign out
                  </Menu.Item>
                </>
              )}
              <Menu.Separator className="mx-1 my-1 h-px bg-border" />
              <Menu.RadioGroup
                value={theme ?? "system"}
                onValueChange={(v: ThemePreference) => setThemePreference(v)}
                className="flex flex-col"
              >
                <Menu.GroupLabel className="px-2 pt-1.5 pb-1 text-caption text-faint">Theme</Menu.GroupLabel>
                <div className="mx-1 mb-1 flex gap-0.5 rounded-lg bg-surface-hover p-0.5">
                  {THEME_OPTIONS.map(({ id, label, Icon }) => (
                    <Menu.RadioItem
                      key={id}
                      value={id}
                      className="flex h-7 flex-1 cursor-default items-center justify-center gap-1.5 rounded-md text-caption text-muted-foreground outline-none transition-colors duration-150 select-none data-checked:bg-surface data-checked:font-semibold data-checked:text-foreground data-checked:ring-1 data-checked:ring-border data-highlighted:text-foreground data-highlighted:ring-1 data-highlighted:ring-ring"
                    >
                      <Icon aria-hidden className="size-3.5" />
                      {label}
                    </Menu.RadioItem>
                  ))}
                </div>
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {result ? <ResultText result={result} /> : null}
    </div>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-border text-caption font-semibold", className)}>
      {initials(name)}
    </span>
  );
}
