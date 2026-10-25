"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { Maximize2Icon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * The view-only E2B desktop stream, with an Enlarge button that opens the same
 * stream in a dialog as large as the window allows. The stream scales to its
 * frame and the desktop's VNC server accepts several viewers, so the small view
 * stays connected behind the dialog.
 */
export function LiveDesktop({
  src,
  title,
  caption,
  className,
  frameClassName,
}: {
  src: string;
  title: string;
  caption: React.ReactNode;
  className?: string;
  frameClassName?: string;
}) {
  const inline = useRef<HTMLIFrameElement>(null);
  const enlarged = useRef<HTMLIFrameElement>(null);
  useFocusStaysOnPage(inline, enlarged);

  return (
    <Dialog.Root>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className={cn("overflow-hidden rounded-lg border bg-rail", frameClassName)}>
          <iframe ref={inline} src={src} title={title} tabIndex={-1} className="pointer-events-none block aspect-[4/3] w-full" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-caption text-muted-foreground">{caption}</p>
          <Dialog.Trigger render={<Button variant="outline" size="xs" />}>
            <Maximize2Icon aria-hidden data-icon="inline-start" />
            Enlarge
          </Dialog.Trigger>
        </div>
      </div>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-rail/70 transition-opacity duration-200 ease-dusk data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(calc(100vw-2rem),calc((100dvh-7rem)*4/3))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-[0_10px_15px_-3px_rgb(0_0_0/0.3),0_4px_6px_-4px_rgb(0_0_0/0.3)] outline-none transition-[opacity,scale] duration-200 ease-dusk data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:data-ending-style:scale-98 motion-safe:data-starting-style:scale-98">
          <div className="flex items-start justify-between gap-3 border-b px-4 pt-3 pb-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Dialog.Title className="text-subheading">Live desktop</Dialog.Title>
              <Dialog.Description className="text-small text-muted-foreground">{caption}</Dialog.Description>
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon aria-hidden />
            </Dialog.Close>
          </div>
          <iframe ref={enlarged} src={src} title={`${title}, enlarged`} tabIndex={-1} className="pointer-events-none block aspect-[4/3] w-full bg-rail" />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * noVNC focuses its canvas as it connects, more than once. Focus then sits in the
 * cross-origin frame and every key, Escape included, goes there, so the dialog
 * cannot be closed from the keyboard. The page only sees a window blur, not a
 * focus event on the frame. The stream is view-only and the frames take no
 * pointer or Tab focus, so whenever one of them holds focus after a blur, focus
 * goes back to the element that lost it. The check waits a task, until the
 * browser has finished moving focus.
 */
function useFocusStaysOnPage(...frames: React.RefObject<HTMLIFrameElement | null>[]) {
  useEffect(() => {
    let previous: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) previous = event.target;
    };
    const onBlur = () => {
      const back = previous;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const frame = frames.map((ref) => ref.current).find((el) => el && el === document.activeElement);
        if (!frame) return;
        if (back?.isConnected) back.focus();
        else window.focus();
      });
    };
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("blur", onBlur);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("blur", onBlur);
    };
    // The refs are stable; their current elements are read when focus moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
