"use client";

import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { ResultText } from "@/components/app/action-button";
import { Field, NativeSelect } from "@/components/app/field";
import { LinkButton } from "@/components/app/link-button";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { ApiError, downloadExport, exportUrl, getQboManifest, type QboManifest, type QboOptions } from "@/lib/client/api";

/**
 * QuickBooks sandbox journal import, the fallback for a direct QBO push.
 * Reads the server's manifest first so excluded foreign-currency lines and
 * warnings are visible before anyone downloads a file.
 */
export function AccountingExports() {
  const [dateFormat, setDateFormat] = useState<NonNullable<QboOptions["dateFormat"]>>("MDY");
  const [multicurrency, setMulticurrency] = useState(false);
  const [manifest, setManifest] = useState<QboManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const mcId = useId();
  const opts = { dateFormat, multicurrency };

  useEffect(() => {
    const ctl = new AbortController();
    getQboManifest({ dateFormat, multicurrency }, ctl.signal)
      .then((m) => {
        setManifestError(null);
        setManifest(m);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setManifest(null);
        setManifestError(e instanceof ApiError ? e.message : "Could not read the export summary.");
      });
    return () => ctl.abort();
  }, [dateFormat, multicurrency]);

  const journals = manifest ? Object.values(manifest.journalNumbers).reduce((n, xs) => n + xs.length, 0) : 0;
  const blocked = Boolean(manifest?.excluded.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <TruthLabel kind="test" />
        <span className="text-small text-muted-foreground">For a QuickBooks sandbox or test company. The ledger holds simulated and test-mode money.</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
        <Field label="Company date format">
          {(p) => (
            <NativeSelect {...p} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as typeof dateFormat)}>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="ISO">YYYY-MM-DD</option>
            </NativeSelect>
          )}
        </Field>
        <label htmlFor={mcId} className="flex h-8 items-center gap-2 text-small">
          <input id={mcId} type="checkbox" checked={multicurrency} onChange={(e) => setMulticurrency(e.target.checked)} />
          The QuickBooks company has multicurrency on
        </label>
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-2 text-small">
        {manifestError ? (
          <ResultText result={{ ok: false, message: manifestError }} />
        ) : !manifest ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
            Checking what the export will contain
          </span>
        ) : (
          <>
            <span>
              {manifest.rowCount} {manifest.rowCount === 1 ? "row" : "rows"} in {journals} {journals === 1 ? "journal" : "journals"}
              {blocked ? "" : ", ready to import."}
            </span>
            {blocked ? (
              <span className="text-critical">
                {manifest.excluded.length} {manifest.excluded.length === 1 ? "entry is" : "entries are"} in{" "}
                {[...new Set(manifest.excluded.map((x) => x.currency))].join(", ")}. Turn on multicurrency above if the company supports it, or use the native ledger CSV.
              </span>
            ) : null}
            {manifest.warnings.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {manifest.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-busy={downloading || undefined}
          disabled={blocked}
          onClick={async () => {
            if (downloading) return;
            setDownloading(true);
            setDownloadError(null);
            try {
              await downloadExport(exportUrl("qbo", undefined, opts));
            } catch (e) {
              setDownloadError(e instanceof ApiError ? e.message : "Download failed. Try again.");
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <DownloadIcon aria-hidden />}
          {downloading ? "Preparing journal CSV" : "Journal CSV"}
        </Button>
        <LinkButton href={exportUrl("qbo-accounts")} external variant="outline">
          <DownloadIcon aria-hidden />
          Account mapping CSV
        </LinkButton>
        <LinkButton href={exportUrl("ledger")} external variant="outline">
          <DownloadIcon aria-hidden />
          Native ledger CSV
        </LinkButton>
      </div>
      {downloadError ? <ResultText result={{ ok: false, message: downloadError }} /> : null}

      {manifest?.instructions ? (
        <details className="rounded-lg border px-4 py-3 text-small">
          <summary className="cursor-pointer font-medium">How to import into QuickBooks</summary>
          <ol className="mt-3 flex max-w-[62ch] list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
            {manifest.instructions
              .split("\n")
              .filter((l) => /^\d+\.\s/.test(l))
              .map((l) => (
                <li key={l}>{l.replace(/^\d+\.\s*/, "")}</li>
              ))}
          </ol>
          {manifest.instructions
            .split("\n")
            .filter((l, i) => i > 0 && !/^\d+\.\s/.test(l) && l.trim())
            .map((l) => (
              <p key={l} className="mt-3 max-w-[62ch] text-muted-foreground">{l}</p>
            ))}
        </details>
      ) : null}
    </div>
  );
}
