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

const KEYS: Record<string, keyof PersonInput> = {
  name: "name", email: "email", country: "country", citizenship: "citizenship",
  dateofbirth: "dateOfBirth", dob: "dateOfBirth", address: "address", role: "role",
  payoutcurrency: "payoutCurrency", currency: "payoutCurrency",
};

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
    people.push(row as unknown as PersonInput);
  });
  return { people, errors, minors };
}
