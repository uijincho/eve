"use client";

import { LoaderCircleIcon, PaperclipIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { ResultText } from "@/components/app/action-button";
import { CheckList } from "@/components/app/evidence-sheet";
import { Field, NativeSelect } from "@/components/app/field";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, Person } from "@/lib/contracts";
import { ApiError, uploadDocument } from "@/lib/client/api";
import { big } from "@/lib/client/derive";
import { payloads, toMinor } from "@/lib/client/payloads";
import { rovingKeyDown } from "@/lib/client/roving";
import { useEve, useLivePolling } from "@/lib/client/use-eve";

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upload a receipt (image or PDF) and submit a claim. Fields left blank are
 * read from the receipt by Eve; anything typed is checked against it.
 */
export function ClaimForm({
  people,
  defaultType = "travel",
  submitLabel = "Submit claim",
  submitVariant = "default",
  onSubmitted,
}: {
  /** Organizers submit for someone; attendees omit this and claim for themselves. */
  people?: Person[];
  defaultType?: "travel" | "expense";
  submitLabel?: string;
  /** Secondary where the page already has its one primary. */
  submitVariant?: "default" | "secondary";
  onSubmitted?: (claimId: string | null) => void;
}) {
  const { act } = useEve();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<"travel" | "expense">(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [personId, setPersonId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [origin, setOrigin] = useState("");
  const [cabin, setCabin] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [result, setResult] = useState<ActionResult | null>(null);
  // One key per claim, kept across retries so a resend after a dropped
  // response cannot file the same receipt twice. Renewed after success.
  const idempotencyKey = useRef<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!file && !amount) next.file = "Attach a receipt, or type the amount and merchant.";
    if (file && file.size > MAX_BYTES) next.file = "That file is over 8 MB. Export a smaller PDF or photo.";
    const minor = amount ? toMinor(amount) : undefined;
    if (amount && !minor) next.amount = "Enter an amount like 495.12.";
    if (!file && !merchant) next.merchant = "Name the merchant, or attach the receipt.";
    if (people && !personId) next.person = "Choose who this claim is for.";
    if (type === "travel" && origin && !/^[A-Za-z]{3}$/.test(origin)) next.origin = "Use a three-letter airport code, like YYZ.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setResult(null);
    let documentId: string | undefined;
    if (file) {
      setPhase("uploading");
      try {
        documentId = (await uploadDocument(file, { kind: "receipt", personId: personId || undefined })).id;
      } catch (err) {
        setPhase("idle");
        setResult({ ok: false, message: err instanceof ApiError ? `Upload failed: ${err.message}` : "Upload failed. Try again." });
        return;
      }
    }
    setPhase("submitting");
    idempotencyKey.current ??= crypto.randomUUID();
    const r = await act(
      payloads.claimSubmit({
        type,
        documentId,
        personId: personId || undefined,
        merchant: merchant || undefined,
        description: description || undefined,
        amountMinor: minor ?? undefined,
        currency: amount ? currency : undefined,
        purchasedAt: purchasedAt || undefined,
        origin: type === "travel" ? origin.toUpperCase() || undefined : undefined,
        cabin: type === "travel" ? cabin || undefined : undefined,
        category: type === "travel" ? "Travel" : undefined,
        idempotencyKey: idempotencyKey.current,
      }),
    );
    setPhase("idle");
    setResult(r);
    if (r.ok) {
      idempotencyKey.current = null;
      const id = typeof r.data?.id === "string" ? r.data.id : typeof r.data?.claimId === "string" ? r.data.claimId : null;
      onSubmitted?.(id);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setAmount("");
      setMerchant("");
      setDescription("");
    }
  };

  const busy = phase !== "idle";
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Claim type" className="flex gap-1">
        {(["travel", "expense"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            tabIndex={type === t ? 0 : -1}
            onClick={() => setType(t)}
            onKeyDown={(e) => rovingKeyDown(e, ["travel", "expense"] as const, type, setType)}
            data-roving
            className={
              type === t
                ? "h-8 rounded-md bg-surface-hover px-3 text-small font-medium"
                : "h-8 rounded-md px-3 text-small font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {t === "travel" ? "Travel" : "Other expense"}
          </button>
        ))}
      </div>

      {people ? (
        <Field label="Claim for" error={errors.person}>
          {(p) => (
            <NativeSelect {...p} value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose a person</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.country}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-small font-medium">
          Receipt or e-ticket
        </label>
        <label
          htmlFor={fileId}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input px-3 py-3 text-small transition-colors duration-150 hover:bg-surface focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        >
          <PaperclipIcon aria-hidden className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {file ? file.name : "Choose a photo or PDF"}
          </span>
          <span className="text-caption text-muted-foreground">PDF, JPG, PNG, WebP · 8 MB</span>
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-describedby={`${fileId}-help`}
            aria-invalid={errors.file ? true : undefined}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p id={`${fileId}-help`} className={errors.file ? "text-small text-critical" : "text-small text-muted-foreground"}>
          {errors.file ?? "Leave the fields below blank and Eve reads them from the receipt. Anything you type is checked against it."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Merchant" error={errors.merchant}>
          {(p) => <Input {...p} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={type === "travel" ? "Air Canada" : "Lyft"} />}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
          <Field label="Amount" error={errors.amount}>
            {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="679.40" />}
          </Field>
          <Field label="Currency">
            {(p) => (
              <NativeSelect {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["USD", "CAD", "EUR", "GBP", "INR", "MXN", "JPY"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Field label="Purchase date">
          {(p) => <Input {...p} type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />}
        </Field>
        {type === "travel" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From airport" error={errors.origin}>
              {(p) => <Input {...p} value={origin} maxLength={3} onChange={(e) => setOrigin(e.target.value)} placeholder="YYZ" className="uppercase" />}
            </Field>
            <Field label="Cabin">
              {(p) => (
                <NativeSelect {...p} value={cabin} onChange={(e) => setCabin(e.target.value)}>
                  <option value="">From receipt</option>
                  <option value="economy">Economy</option>
                  <option value="premium">Premium economy</option>
                  <option value="business">Business</option>
                </NativeSelect>
              )}
            </Field>
          </div>
        ) : (
          <Field label="What was it for?">
            {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ride to venue" />}
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} aria-busy={busy || undefined} disabled={busy}>
          {busy ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {phase === "uploading" ? "Uploading receipt" : phase === "submitting" ? "Submitting" : submitLabel}
        </Button>
        <span role="status" aria-live="polite">
          {result ? <ResultText result={result} /> : null}
        </span>
      </div>
    </form>
  );
}

/** A submitted claim's persisted status and checks, live while Eve works. */
export function ClaimOutcome({ claimId }: { claimId: string }) {
  const { snapshot } = useEve();
  const claim = snapshot?.claims.find((c) => c.id === claimId);
  const working = !claim || claim.status === "submitted" || claim.status === "processing";
  useLivePolling(working);
  if (!claim) {
    return (
      <p className="flex items-center gap-2 text-small text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
        Waiting for claim {claimId} to appear.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {claim.id} · {claim.merchant || "Reading receipt"}
        </span>
        <span className="flex items-center gap-2">
          <Money amountMinor={big(claim.usdMinor)} className="font-semibold" />
          <StatusBadge status={claim.status} />
        </span>
      </div>
      {claim.reason ? <p className="text-small text-muted-foreground">{claim.reason}</p> : null}
      {claim.checks.length ? (
        <CheckList checks={claim.checks} />
      ) : (
        <p className="flex items-center gap-2 text-small text-muted-foreground">
          <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
          Eve is reading the receipt and running the policy checks.
        </p>
      )}
    </div>
  );
}
