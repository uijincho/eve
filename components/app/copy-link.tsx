"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A one-time invite link, selectable and copyable. Eve does not email it. */
export function CopyLink({ url, label = "Invite link" }: { url: string; label?: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium">{label}</label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-caption" aria-describedby={`${id}-help`} />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2_000);
            } catch {
              document.getElementById(id)?.focus();
            }
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-small text-muted-foreground">
        Not emailed. Send it yourself; it works once, only for the invited email, and expires in 7 days. It is shown only now.
      </p>
    </div>
  );
}
