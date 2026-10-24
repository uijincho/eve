// CSV with RFC 4180 quoting and spreadsheet formula-injection protection:
// any cell starting with = + - @ tab or CR is prefixed with an apostrophe.

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "bigint" ? value.toString() : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
