// Parses an attendee CSV into people.import rows, with row-level problems.
import { isAdultOn } from "./derive";
import type { PersonInput } from "./payloads";

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const KEYS: Record<string, keyof PersonInput | "project" | "submitted"> = {
  name: "name", email: "email", country: "country", citizenship: "citizenship",
  dateofbirth: "dateOfBirth", dob: "dateOfBirth", address: "address", role: "role",
  payoutcurrency: "payoutCurrency", currency: "payoutCurrency",
  project: "project", projecturl: "projectUrl", url: "projectUrl", submitted: "submitted",
};

const PROJECT_STATUS: Record<string, NonNullable<PersonInput["projectStatus"]>> = {
  yes: "submitted", y: "submitted", true: "submitted", "1": "submitted", submitted: "submitted",
  no: "none", n: "none", false: "none", "0": "none", none: "none",
  unknown: "unknown",
};

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function parsePeopleCsv(text: string, eventStart: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const people: PersonInput[] = [];
  let minors = 0;
  if (!lines.length) return { people, errors, minors };
  const header = splitLine(lines[0]).map((h) => KEYS[h.toLowerCase().replace(/[^a-z]/g, "")]);
  for (const need of ["name", "email", "country", "dateOfBirth"] as const) {
    if (!header.includes(need)) errors.push(`Missing column: ${need}`);
  }
  if (errors.length) return { people, errors, minors };
  lines.slice(1).forEach((line, i) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((k, j) => { if (k && cells[j]) row[k] = cells[j]; });
    const n = i + 2;
    if (!row.name) errors.push(`Row ${n}: name is missing.`);
    if (!/^\S+@\S+\.\S+$/.test(row.email ?? "")) errors.push(`Row ${n}: email is not valid.`);
    row.country = (row.country ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(row.country)) errors.push(`Row ${n}: country must be two letters, like CA.`);
    if (row.citizenship) row.citizenship = row.citizenship.toUpperCase();
    if (row.payoutCurrency) row.payoutCurrency = row.payoutCurrency.toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth ?? "")) errors.push(`Row ${n}: dateOfBirth must be YYYY-MM-DD.`);
    else if (!isAdultOn(row.dateOfBirth, eventStart)) minors++;
    const person: PersonInput = {
      name: row.name ?? "", email: row.email ?? "", country: row.country, dateOfBirth: row.dateOfBirth ?? "",
      ...(row.citizenship ? { citizenship: row.citizenship } : {}),
      ...(row.address ? { address: row.address } : {}),
      ...(row.role ? { role: row.role } : {}),
      ...(row.payoutCurrency ? { payoutCurrency: row.payoutCurrency } : {}),
    };
    if (row.submitted) {
      const status = PROJECT_STATUS[row.submitted.toLowerCase()];
      if (!status) errors.push(`Row ${n}: submitted must be yes, no, or unknown.`);
      else person.projectStatus = status;
    }
    if (row.projectUrl) {
      person.projectUrl = row.projectUrl;
      if (!person.projectStatus) person.projectStatus = "submitted";
    }
    if (row.project) {
      const value = row.project.trim();
      const asStatus = PROJECT_STATUS[value.toLowerCase()];
      if (asStatus) person.projectStatus ??= asStatus;
      else if (looksLikeUrl(value)) {
        person.projectUrl ??= value;
        person.projectStatus ??= "submitted";
      } else person.projectStatus ??= "submitted";
    }
    people.push(person);
  });
  return { people, errors, minors };
}

export interface SubmissionEntry { email?: string; name?: string; projectUrl?: string }

/**
 * A pasted Devpost or judging export: a header with email and/or name, or one
 * email or name per line. Reuses the people CSV splitter. Project titles are
 * ignored; a URL in a project/url column is kept.
 */
export function parseSubmissionList(text: string): { entries: SubmissionEntry[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const entries: SubmissionEntry[] = [];
  if (!lines.length) return { entries, errors: ["Paste at least one email or name."] };
  const headerCells = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const emailIdx = headerCells.findIndex((h) => h === "email" || h === "emailaddress");
  const nameIdx = headerCells.findIndex((h) => h === "name" || h === "fullname");
  const urlIdx = headerCells.findIndex((h) => h === "projecturl" || h === "url" || h === "submissionurl" || h === "project");
  const hasHeader = emailIdx >= 0 || nameIdx >= 0;
  const body = hasHeader ? lines.slice(1) : lines;
  body.forEach((line, i) => {
    const cells = splitLine(line);
    const n = i + (hasHeader ? 2 : 1);
    if (hasHeader) {
      const email = emailIdx >= 0 ? cells[emailIdx]?.trim() : "";
      const name = nameIdx >= 0 ? cells[nameIdx]?.trim() : "";
      const urlCell = urlIdx >= 0 ? cells[urlIdx]?.trim() : "";
      const projectUrl = urlCell && looksLikeUrl(urlCell) ? urlCell : undefined;
      if (!email && !name) { errors.push(`Row ${n}: needs an email or a name.`); return; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { errors.push(`Row ${n}: email is not valid.`); return; }
      entries.push({ ...(email ? { email } : {}), ...(name ? { name } : {}), ...(projectUrl ? { projectUrl } : {}) });
      return;
    }
    const cell = (cells[0] ?? "").trim();
    if (!cell) return;
    if (/^\S+@\S+\.\S+$/.test(cell)) {
      const url = cells[1] && looksLikeUrl(cells[1]) ? cells[1].trim() : undefined;
      entries.push({ email: cell, ...(url ? { projectUrl: url } : {}) });
    } else entries.push({ name: cells.length > 1 ? cells.filter(Boolean).join(" ") : cell });
  });
  if (!entries.length && !errors.length) errors.push("Paste at least one email or name.");
  return { entries, errors };
}
