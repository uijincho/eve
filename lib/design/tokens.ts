// Daylight tokens as data, for the /design reference page. `dark` is the
// Lamplight value; where it equals `value`, the dark theme leaves it alone.
// The source of truth is app/globals.css; tests/design.test.ts fails if these
// values drift from it.

export type ColorToken = {
  name: string;
  value: string;
  dark: string;
  role: string;
};

export const STRUCTURE: ColorToken[] = [
  { name: "--rail", value: "#ffffff", dark: "#17181d", role: "Navigation rail and top bar" },
  { name: "--background", value: "#f3f3ef", dark: "#0e0f13", role: "Page ground" },
  { name: "--surface", value: "#ffffff", dark: "#17181d", role: "Cards and raised panels" },
  { name: "--surface-hover", value: "#ebebe5", dark: "#212228", role: "Row hover, selected rows, secondary buttons" },
  { name: "--border", value: "#e4e4de", dark: "#2a2b32", role: "Hairlines between surfaces" },
  { name: "--input", value: "#8e8f86", dark: "#6b6d77", role: "Field boundaries" },
];

export const TEXT: ColorToken[] = [
  { name: "--foreground", value: "#17181a", dark: "#ecedf1", role: "Primary text, figures, primary button fill" },
  { name: "--muted-foreground", value: "#5d5e57", dark: "#a2a4ad", role: "Secondary text, placeholders" },
  { name: "--faint", value: "#6b6c64", dark: "#8b8d97", role: "Tertiary text on the ground or rail only" },
];

export const DUSK: (ColorToken & { band: 1 | 2 | 3 | 4 | 5 })[] = [
  { name: "--dusk-5", value: "#a3500e", dark: "#f2a066", band: 5, role: "Under an hour" },
  { name: "--dusk-4", value: "#b8365a", dark: "#f27b9c", band: 4, role: "Under a day" },
  { name: "--dusk-3", value: "#8e3bab", dark: "#c98ae6", band: 3, role: "Under 2 days" },
  { name: "--dusk-2", value: "#5450c8", dark: "#9d9af6", band: 2, role: "Under a week" },
  { name: "--dusk-1", value: "#1f6aa5", dark: "#62a5e3", band: 1, role: "A week or more" },
];

export const STATE: ColorToken[] = [
  { name: "--critical", value: "#b42318", dark: "#f47a6d", role: "Frozen, failed, over cap. Also the destructive action" },
  { name: "--positive", value: "#3d6b10", dark: "#a4d16a", role: "Passed, paid, verified" },
];

export const FILL: ColorToken[] = [
  { name: "--money", value: "#a3cf5b", dark: "#a3cf5b", role: "Money received or cleared. Fill only, never text" },
  { name: "--pending", value: "#f2a65a", dark: "#f2a65a", role: "Money pending or estimated; hatched when an estimate" },
];

export const GROUND = "#f3f3ef";
export const RAISED = "#ffffff";
export const DARK_GROUND = "#0e0f13";
export const DARK_RAISED = "#17181d";

export const TYPE_SCALE = [
  { token: "text-display", spec: "40 / 44 · 600 · −2.5%", sample: "Blue Hour", use: "This page only" },
  { token: "text-title", spec: "28 / 34 · 600 · −2%", sample: "Inbox", use: "Page titles" },
  { token: "text-heading", spec: "20 / 28 · 600 · −1%", sample: "Payout batch #4", use: "Section and panel headings" },
  { token: "text-subheading", spec: "16 / 24 · 600", sample: "Prize to a winner in Canada", use: "Group labels, dialog titles" },
  { token: "text-body", spec: "14 / 20 · 400 and 600", sample: "Eve froze the payout and emailed Jordan's original address.", use: "Default UI text, row titles in 600" },
  { token: "text-small", spec: "13 / 18 · 400", sample: "Jordan Okafor · 2nd place, Best Hardware Hack", use: "Meta lines, help text" },
  { token: "text-caption", spec: "12 / 16 · 400 and 500", sample: "2:00 PM release", use: "Due context, axis labels, badges" },
] as const;

export const SPACE = [4, 8, 12, 16, 24, 32, 48] as const;

export const RADII = [
  { token: "rounded-sm", px: 4, use: "Truth labels, bars" },
  { token: "rounded-md", px: 6, use: "Small controls" },
  { token: "rounded-lg", px: 8, use: "Buttons, fields" },
  { token: "rounded-xl", px: 10, use: "Panels, popovers" },
] as const;

/** WCAG 2 contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
