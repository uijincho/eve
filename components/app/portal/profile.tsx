"use client";

import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { Field, NativeSelect } from "@/components/app/field";
import { Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { TruthLabel } from "@/components/eve/truth-label";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Person } from "@/lib/contracts";
import { isAdultOn, projectStatusLabel } from "@/lib/client/derive";
import { fmtDate } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";

import { PortalFrame } from "./portal-frame";

export const COUNTRIES: [string, string][] = [
  ["US", "United States"], ["CA", "Canada"], ["MX", "Mexico"], ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"],
  ["IN", "India"], ["CN", "China"], ["JP", "Japan"], ["KR", "South Korea"], ["BR", "Brazil"], ["NG", "Nigeria"], ["AU", "Australia"],
];

export function PortalProfile() {
  return (
    <PortalFrame title="Profile and tax form" lede="Eve needs to know who you are for tax before any money is promised. Your tax ID goes straight to an encrypted vault; Eve only sees its last four digits.">
      {(s, me) => (
        <div className="flex max-w-2xl flex-col gap-12">
          <Identity snapshot={s} me={me} key={`id-${me.id}`} />
          <TaxForm snapshot={s} me={me} key={`tax-${me.id}`} />
        </div>
      )}
    </PortalFrame>
  );
}

function Identity({ snapshot: s, me }: { snapshot: AppSnapshot; me: Person }) {
  const [name, setName] = useState(me.name);
  const [dob, setDob] = useState(me.dateOfBirth ?? "");
  const [citizenship, setCitizenship] = useState(me.citizenship);
  const [country, setCountry] = useState(me.country);
  const [address, setAddress] = useState(me.address);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const minor = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) && !isAdultOn(dob, s.event.startsAt);
  return (
    <Section title="About you">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name" error={errors.name} help="As it appears on your ID. Your tax form signature must match it.">
          {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Date of birth" error={errors.dob ?? (minor ? `You must be 18 by ${fmtDate(s.event.startsAt, true)} to receive money from this event.` : null)}>
          {(p) => <Input {...p} type="date" autoComplete="bday" value={dob} onChange={(e) => setDob(e.target.value)} />}
        </Field>
        <Field label="Citizenship">
          {(p) => (
            <NativeSelect {...p} value={citizenship} onChange={(e) => setCitizenship(e.target.value)}>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Country of tax residency">
          {(p) => (
            <NativeSelect {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Mailing address" className="sm:col-span-2">
          {(p) => <Input {...p} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
      </div>
      <p className="text-small text-muted-foreground">Your email, {me.email}, is the original contact channel and cannot change here.</p>
      <p className="text-small text-muted-foreground">Project submission: {projectStatusLabel(me.projectStatus)}{me.projectUrl ? ` · ${me.projectUrl}` : ""}. Only an organizer can change this.</p>
      <ActionButton
        className="self-start"
        label="Save profile"
        pendingLabel="Saving"
        call={() => {
          const e: Record<string, string> = {};
          if (!name.trim()) e.name = "Enter your legal name.";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) e.dob = "Enter your date of birth.";
          setErrors(e);
          if (Object.keys(e).length) return null;
          return payloads.personUpdate(me.id, { name: name.trim(), dateOfBirth: dob, citizenship, country, address: address.trim() });
        }}
      />
    </Section>
  );
}

function TaxForm({ snapshot: s, me }: { snapshot: AppSnapshot; me: Person }) {
  // The server decides which form applies (payer country, US-person status); use its answer.
  const suggested = me.taxForm;
  const [form, setForm] = useState<Person["taxForm"]>(me.taxStatus === "valid" ? me.taxForm : suggested);
  const [tin, setTin] = useState("");
  const [noTin, setNoTin] = useState(false);
  const [treaty, setTreaty] = useState(me.country !== s.org.country ? me.country : "");
  const [article, setArticle] = useState("");
  const [signature, setSignature] = useState("");
  const [certify, setCertify] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rule = s.rules.find((r) => r.form === form && (r.payeeCountry === me.country || r.payeeCountry === "*"));

  return (
    <Section title="Tax form" aside={<span className="inline-flex items-center gap-2">{me.taxForm} <StatusBadge status={me.taxStatus} />{me.taxLast4 ? ` TIN ••${me.taxLast4}` : ""}</span>}>
      <p className="text-small text-muted-foreground">
        {s.org.country === "CA"
          ? <>Because {s.org.name} pays from Canada, Eve asks for a <span className="font-medium text-foreground">{suggested}</span>.</>
          : me.citizenship === "US" && me.country !== "US"
            ? <>As a US citizen, you file a <span className="font-medium text-foreground">{suggested}</span> even though you live in {COUNTRIES.find(([c]) => c === me.country)?.[1] ?? me.country}.</>
            : <>Because you live in {COUNTRIES.find(([c]) => c === me.country)?.[1] ?? me.country} and are a citizen of {COUNTRIES.find(([c]) => c === me.citizenship)?.[1] ?? me.citizenship}, Eve asks for a <span className="font-medium text-foreground">{suggested}</span>.</>}
        {me.taxExpiresAt ? ` Your current form expires ${fmtDate(me.taxExpiresAt, true)}.` : ""}
      </p>
      {rule && !rule.verified ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <TruthLabel kind="unverified" /> {form === "W-8BEN" ? "The treaty rate for your country has not been verified yet, so a controller reviews it before you are paid." : "The tax rule for this payment has not been verified yet, so a controller reviews it before you are paid."}
        </p>
      ) : null}
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Form">
            {(p) => (
              <NativeSelect {...p} value={form} onChange={(e) => setForm(e.target.value as Person["taxForm"])}>
                {(["W-9", "W-8BEN", "W-8BEN-E", "Residency declaration"] as const).map((f) => (
                  <option key={f} value={f}>{f}{f === suggested ? " (suggested)" : ""}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={form === "W-9" ? "SSN or ITIN" : form === "Residency declaration" ? (me.country === "CA" ? "SIN (optional)" : "Tax ID (optional)") : "Foreign tax ID (optional)"} error={errors.tin} help={form === "W-9" ? "Sent once to the vault. If you cannot provide a TIN yet, choose the option below." : "Sent once to the vault. It is never shown again."}>
            {(p) => <Input {...p} type="password" autoComplete="off" inputMode="text" value={tin} onChange={(e) => { setTin(e.target.value.replace(/[^0-9A-Za-z-]/g, "")); setNoTin(false); setErrors((current) => ({ ...current, tin: "" })); }} />}
          </Field>
          {form === "W-9" ? (
            <label className="flex items-start gap-2 text-small sm:col-span-2">
              <input type="checkbox" checked={noTin} onChange={(e) => { setNoTin(e.target.checked); if (e.target.checked) setTin(""); setErrors((current) => ({ ...current, tin: "" })); }} className="mt-0.5 size-4 accent-foreground" />
              <span>TIN not provided. <span className="text-muted-foreground">Eve applies backup withholding when required.</span></span>
            </label>
          ) : null}
          {form === "W-8BEN" ? (
            <Field label="Treaty country" help="Prefilled from your residency.">
              {(p) => (
                <NativeSelect {...p} value={treaty} onChange={(e) => setTreaty(e.target.value)}>
                  <option value="">No treaty claim</option>
                  {COUNTRIES.filter(([c]) => c !== "US").map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          {form === "W-8BEN" && treaty ? (
            <Field label="Treaty article (optional)" help="Part II of the W-8BEN, for example Article XXII. Leave it blank unless you claim a reduced rate.">
              {(p) => <Input {...p} value={article} maxLength={40} onChange={(e) => setArticle(e.target.value)} placeholder="Article XXII" />}
            </Field>
          ) : null}
          <Field label="Signature" error={errors.signature} help={`Type your full legal name: ${me.name}`}>
            {(p) => <Input {...p} value={signature} onChange={(e) => setSignature(e.target.value)} />}
          </Field>
        </div>
        <label className="flex items-start gap-2 text-small">
          <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5 size-4 accent-foreground" aria-describedby="certify-err" />
          <span>{form === "Residency declaration" ? "I confirm that my residency information is true, correct, and complete." : "I certify under penalties of perjury that the information on this form is true, correct, and complete."} <span className="text-muted-foreground">(Typed signatures are demo-grade.)</span></span>
        </label>
        {errors.certify ? <p id="certify-err" className="text-small text-critical">{errors.certify}</p> : null}
        <ActionButton
          className="self-start"
          variant="default"
          size="default"
          label={`Sign ${form}`}
          pendingLabel="Signing"
          onDone={(r) => {
            if (r.ok) {
              setTin("");
              setNoTin(false);
              setSignature("");
              setCertify(false);
            }
          }}
          call={() => {
            const e: Record<string, string> = {};
            if (signature.trim().toLowerCase() !== me.name.trim().toLowerCase()) e.signature = `Type your name exactly as on your profile: ${me.name}.`;
            if (form === "W-9" && !tin && !noTin) e.tin = "Enter your SSN or ITIN, or choose TIN not provided.";
            if (tin && (tin.length < 4 || tin.length > 20)) e.tin = "Tax IDs are 4 to 20 letters, digits, or dashes.";
            if (!certify) e.certify = "Check the certification to sign.";
            setErrors(e);
            if (Object.keys(e).length) return null;
            return payloads.taxSubmit({ personId: me.id, form, signature: signature.trim(), tin: tin || undefined, treatyCountry: form === "W-8BEN" ? treaty || undefined : undefined, treatyArticle: form === "W-8BEN" && treaty ? article.trim() || undefined : undefined });
          }}
        />
      </form>
    </Section>
  );
}
