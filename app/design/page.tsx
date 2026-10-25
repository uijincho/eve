import { LoaderCircleIcon, SearchIcon, SendIcon } from "lucide-react";
import type { Metadata } from "next";

import { BlockedAction } from "@/components/eve/blocked-action";
import { BreakdownBar } from "@/components/eve/breakdown-bar";
import { CapacityBar } from "@/components/eve/capacity-bar";
import { DueChip } from "@/components/eve/due-chip";
import { Evidence } from "@/components/eve/evidence";
import { Horizon } from "@/components/eve/horizon";
import { InboxList, InboxRow, InboxRowSkeleton } from "@/components/eve/inbox-row";
import { Money } from "@/components/eve/money";
import { TemperatureScale } from "@/components/eve/temperature-scale";
import { TruthLabel } from "@/components/eve/truth-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SAMPLE_INBOX, SAMPLE_NOW } from "@/lib/design/sample";
import {
  DUSK,
  GROUND,
  RADII,
  RAISED,
  SPACE,
  STATE,
  STRUCTURE,
  TEXT,
  TYPE_SCALE,
  contrastRatio,
  type ColorToken,
} from "@/lib/design/tokens";

import { ClaimsTable } from "./_components/claims-table";
import { InboxExample } from "./_components/inbox-example";
import { Code, Section, Specimen } from "./_components/section";
import { MobileIndex, SectionIndex, type IndexEntry } from "./_components/section-index";

export const metadata: Metadata = {
  title: "Daylight · Eve design system",
  description: "Tokens, components, and patterns for Eve's interface.",
};

const INDEX: IndexEntry[] = [
  { id: "overview", label: "Overview" },
  { id: "principles", label: "Principles" },
  { id: "colour", label: "Colour" },
  { id: "type", label: "Type" },
  { id: "space", label: "Space and shape" },
  {
    id: "components",
    label: "Components",
    children: [
      { id: "buttons", label: "Buttons" },
      { id: "fields", label: "Fields" },
      { id: "tabs", label: "Tabs" },
      { id: "badges", label: "Badges and labels" },
      { id: "due-chips", label: "Due chips" },
      { id: "money", label: "Money" },
      { id: "bars", label: "Bars" },
      { id: "tables", label: "Tables" },
    ],
  },
  {
    id: "patterns",
    label: "Patterns",
    children: [
      { id: "inbox-rows", label: "Inbox rows" },
      { id: "blocked", label: "Blocked actions" },
      { id: "evidence", label: "Evidence" },
      { id: "empty", label: "Loading and empty" },
    ],
  },
  { id: "example", label: "Inbox example" },
];

const HOUR = 3_600_000;
const at = (ms: number) => new Date(new Date(SAMPLE_NOW).getTime() + ms).toISOString();

const DUE_EXAMPLES = [
  { due: at(0.3 * HOUR), context: "2:00 PM release" },
  { due: at(5 * HOUR), context: "end of day" },
  { due: at(43 * HOUR), context: "claims review" },
  { due: at(80 * HOUR), context: "next chase" },
  { due: at(220 * HOUR), context: "month-end close" },
];

const SORT_OPTIONS = [
  { value: "urgency", label: "Urgency" },
  { value: "amount", label: "Amount" },
  { value: "newest", label: "Newest" },
];

export default function DesignPage() {
  return (
    <div className="mx-auto flex w-full max-w-[80rem] gap-16 px-5 sm:px-8 lg:px-10">
      <aside className="sticky top-0 hidden h-dvh w-44 shrink-0 flex-col gap-8 overflow-y-auto py-10 lg:flex">
        <Wordmark />
        <SectionIndex entries={INDEX} />
      </aside>

      <main className="min-w-0 flex-1 pt-8 pb-32 lg:pt-10">
        <div className="sticky top-0 z-20 -mx-5 mb-10 flex items-center justify-between gap-4 border-b bg-background px-5 py-3 sm:-mx-8 sm:px-8 lg:hidden">
          <Wordmark />
          <MobileIndex entries={INDEX} />
        </div>

        {/* Overview */}
        <section id="overview" aria-labelledby="overview-title" className="scroll-mt-20 pb-16 lg:scroll-mt-6">
          <div className="flex items-start justify-between gap-6">
            <h1 id="overview-title" className="text-display">
              Daylight
            </h1>
            <TruthLabel kind="sample" className="mt-3" />
          </div>
          <p className="mt-4 max-w-[56ch] text-subheading font-normal text-muted-foreground">
            Eve&apos;s interface is set on warm paper with white cards. Lime and
            apricot fill money in and money pending; the dusk hues still do one
            job: they tell you how soon something is due.
          </p>

          <div className="mt-14">
            <Horizon
              items={SAMPLE_INBOX.map((i) => ({ id: i.id, label: i.mark, dueAt: i.dueAt }))}
              now={SAMPLE_NOW}
              nowLabel="1:42 PM"
            />
          </div>
          <TemperatureScale className="mt-8" />
          <p className="mt-3 text-small text-muted-foreground">
            The horizon: every open deadline in the organizer inbox at 1:42 PM on
            closing day, from now to two weeks out.
          </p>
        </section>

        <Section id="principles" title="Principles">
          <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
            <Principle term="Colour means time">
              Dusk hues appear only on deadlines. If something has a hue, it is
              due. Coral (critical) and mint (passed) are the only other colours.
            </Principle>
            <Principle term="Every figure traces to its source">
              Amounts that come from a document, rule, or rate link to that
              evidence. Eve explains from the record, not from memory.
            </Principle>
            <Principle term="Blocked actions say why">
              When segregation of duties stops you, the action stays visible and
              disabled, with the reason beside it.
            </Principle>
            <Principle term="Estimates say so">
              Truth labels mark estimates, sample data, test mode, and
              unverified rules.
            </Principle>
          </dl>
        </Section>

        <Section
          id="colour"
          title="Colour"
          lede="Structure is warm paper under white cards. Hairlines separate surfaces; the page itself casts no shadows."
        >
          <Specimen title="Structure">
            <ColorTable tokens={STRUCTURE} contrast={(t) => (t.name === "--input" ? `${ratio(t.value, GROUND)} on ground` : null)} />
          </Specimen>
          <Specimen title="Text" note="Contrast on the ground and on raised surfaces. Faint text stays on the ground or rail.">
            <ColorTable
              tokens={TEXT}
              contrast={(t) => `${ratio(t.value, GROUND)} · ${ratio(t.value, RAISED)}`}
              sample
            />
          </Specimen>
          <Specimen title="Time" note="Five steps from cool to warm, keyed to how much time is left. Use them for deadlines and nothing else. Contrast on the ground and on raised surfaces.">
            <ColorTable tokens={DUSK} contrast={(t) => `${ratio(t.value, GROUND)} · ${ratio(t.value, RAISED)}`} sample />
          </Specimen>
          <Specimen title="State" note="Contrast on the ground and on raised surfaces.">
            <ColorTable tokens={STATE} contrast={(t) => `${ratio(t.value, GROUND)} · ${ratio(t.value, RAISED)}`} sample />
          </Specimen>
        </Section>

        <Section
          id="type"
          title="Type"
          lede="Hanken Grotesk at every size. Its figures are tabular by default, so amounts align in columns with no extra settings."
        >
          <div className="flex flex-col">
            {TYPE_SCALE.map((t) => (
              <div key={t.token} className="grid gap-x-8 gap-y-1 border-b py-5 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <div className="flex flex-col gap-0.5">
                  <Code>{t.token}</Code>
                  <span className="text-caption text-faint">{t.spec}</span>
                </div>
                <p className={`${t.token} truncate`}>{t.sample}</p>
              </div>
            ))}
          </div>
          <Specimen title="Figures" note="Amounts right-align on the decimal. Deductions use a true minus sign.">
            <div className="flex w-fit flex-col items-end gap-1 text-heading font-medium">
              <Money amountMinor={1_245_000} />
              <Money amountMinor={129_900} />
              <Money amountMinor={-38_970} />
              <Money amountMinor={3_820} />
            </div>
          </Specimen>
        </Section>

        <Section id="space" title="Space and shape" lede="A 4 px rhythm. Tight inside groups, generous between them.">
          <Specimen title="Spacing">
            <div className="flex flex-col gap-2">
              {SPACE.map((px) => (
                <div key={px} className="flex items-center gap-4">
                  <span className="w-8 text-right text-caption tabular-nums text-muted-foreground">{px}</span>
                  <span className="h-2 rounded-sm bg-chart-3" style={{ width: px * 4 }} />
                </div>
              ))}
            </div>
          </Specimen>
          <Specimen title="Radius">
            <div className="flex flex-wrap gap-6">
              {RADII.map((r) => (
                <div key={r.token} className="flex flex-col gap-2">
                  <span className="size-16 border border-input bg-surface" style={{ borderRadius: r.px }} />
                  <Code>{r.token}</Code>
                  <span className="text-caption text-faint">
                    {r.px} px · {r.use}
                  </span>
                </div>
              ))}
            </div>
          </Specimen>
          <Specimen title="Elevation" note="The page is flat. Only things that float over it, menus and tooltips, cast a shadow.">
            <div className="flex flex-wrap items-start gap-6">
              <div className="w-56 rounded-xl border bg-surface p-4 text-small text-muted-foreground">
                Panel: surface fill, hairline border, no shadow.
              </div>
              <div className="w-56 rounded-xl bg-popover p-4 text-small text-muted-foreground shadow-lg shadow-black/30 ring-1 ring-border">
                Popover: one step lighter, with a shadow.
              </div>
            </div>
          </Specimen>
        </Section>

        <Section id="components" title="Components">
          <Specimen
            id="buttons"
            title="Buttons"
            note="One primary per view, in the cool-white fill. A row's first action is secondary; the rest are ghost. Hover lightens the fill; focus adds a ring; disabled drops to the surface; pending keeps its label and spins."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button>Approve</Button>
              <Button variant="secondary">Ask for info</Button>
              <Button variant="outline">Export CSV</Button>
              <Button variant="ghost">View evidence</Button>
              <Button variant="destructive">Reject</Button>
            </div>
            <div className="flex flex-wrap items-start gap-6">
              <ButtonState label="Default">
                <Button>Release batch</Button>
              </ButtonState>
              <ButtonState label="Disabled">
                <Button disabled>Release batch</Button>
              </ButtonState>
              <ButtonState label="Pending">
                <Button aria-busy>
                  <LoaderCircleIcon aria-hidden className="animate-spin" />
                  Releasing
                </Button>
              </ButtonState>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary">Small</Button>
              <Button variant="secondary">Default</Button>
              <Button size="lg" variant="secondary">Large</Button>
              <Button variant="secondary">
                <SendIcon aria-hidden />
                Send now
              </Button>
            </div>
          </Specimen>

          <Specimen id="fields" title="Fields" note="Labels sit above fields. Help and errors sit below, and errors say how to fix the problem.">
            <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
              <Field label="Legal name" help="As it appears on your tax form." htmlFor="f-name">
                <Input id="f-name" defaultValue="Priya Raman" />
              </Field>
              <Field label="Date of birth" htmlFor="f-dob" error="Eve pays adults only. Attendees must be 18 by Oct 23, 2026.">
                <Input id="f-dob" defaultValue="2009-04-18" aria-invalid aria-describedby="f-dob-msg" />
              </Field>
              <Field label="Search" htmlFor="f-search">
                <div className="relative">
                  <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="f-search" placeholder="Search inbox" className="pl-8" />
                </div>
              </Field>
              <Field label="Sort" htmlFor="f-sort">
                <Select defaultValue="urgency" items={SORT_OPTIONS}>
                  <SelectTrigger id="f-sort" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2.5 text-body">
                <Checkbox defaultChecked />
                The organization pays payout fees
              </label>
            </div>
          </Specimen>

          <Specimen id="tabs" title="Tabs" note="Underlined, with counts in tabular figures.">
            <Tabs defaultValue="all">
              <TabsList variant="line">
                {[
                  ["all", "All", 7],
                  ["approvals", "Approvals", 3],
                  ["holds", "Holds", 2],
                  ["exceptions", "Exceptions", 2],
                ].map(([value, label, n]) => (
                  <TabsTrigger key={value} value={value} className="px-2">
                    {label}
                    <span className="text-caption tabular-nums text-muted-foreground">{n}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </Specimen>

          <Specimen
            id="badges"
            title="Badges and labels"
            note="Badges carry state. Truth labels carry honesty: anything estimated, sample, test-mode, or unverified says so."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="critical">Frozen</Badge>
              <Badge variant="positive">Paid</Badge>
              <Badge variant="pending">Escalated</Badge>
              <Badge variant="outline">Held</Badge>
              <Badge variant="secondary">Draft</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TruthLabel kind="sample" />
              <TruthLabel kind="test" />
              <TruthLabel kind="estimate" />
              <TruthLabel kind="unverified" />
            </div>
          </Specimen>

          <Specimen id="due-chips" title="Due chips" note="The deadline in its band's hue, with what the deadline is underneath.">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              {DUE_EXAMPLES.map((d) => (
                <DueChip key={d.due} due={d.due} now={SAMPLE_NOW} context={d.context} />
              ))}
            </div>
          </Specimen>

          <Specimen id="money" title="Money" note="Stored as integer minor units with a currency code; formatted without floats.">
            <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-8 gap-y-3">
              <MoneyRow term="Amount"><Money amountMinor={150_000} /></MoneyRow>
              <MoneyRow term="Foreign currency">
                <span className="text-muted-foreground"><Money amountMinor={67_940} currency="CAD" /> → </span>
                <Money amountMinor={49_512} />
              </MoneyRow>
              <MoneyRow term="Estimate"><Money amountMinor={90_930} estimate /></MoneyRow>
              <MoneyRow term="Deduction"><Money amountMinor={-38_970} /></MoneyRow>
              <MoneyRow term="Traced to its source">
                <Evidence source="Rule US-NRA-PRIZE v2 · 30% default, treaty rate unverified">
                  <Money amountMinor={38_970} />
                </Evidence>
              </MoneyRow>
            </dl>
          </Specimen>

          <Specimen id="bars" title="Bars" note="One fixed scale per bar. Net is what is left of gross; remaining sits against the cap.">
            <div className="grid gap-12 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <p className="font-semibold">Priya&apos;s prize, as cash</p>
                <BreakdownBar
                  grossMinor={129_900}
                  deductions={[
                    { label: "Withholding 30%", amountMinor: 38_970, kind: "withholding" },
                    { label: "Payout fee", amountMinor: 0, kind: "fee" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-10">
                <CapacityBar label="Travel" capMinor={6_000_000} spentMinor={3_842_000} committedMinor={920_000} />
                <CapacityBar label="Food" capMinor={800_000} spentMinor={720_000} committedMinor={140_000} />
              </div>
            </div>
          </Specimen>

          <Specimen id="tables" title="Tables" note="Dense rows, sortable headers, figures right-aligned. Sort by any column.">
            <ClaimsTable />
          </Specimen>
        </Section>

        <Section id="patterns" title="Patterns">
          <Specimen
            id="inbox-rows"
            title="Inbox rows"
            note="What happened, the people involved, why Eve escalated it, the amount, the deadline, and what you can do."
          >
            <InboxList>
              <InboxRow item={SAMPLE_INBOX[0]} now={SAMPLE_NOW} />
              <InboxRow item={SAMPLE_INBOX[3]} now={SAMPLE_NOW} />
            </InboxList>
          </Specimen>

          <Specimen
            id="blocked"
            title="Blocked actions"
            note="Requesters cannot approve their own payments. The control stays in place, disabled but focusable, so everyone can see the rule."
          >
            <BlockedAction
              action="Release batch"
              reason="You requested this batch, so a controller must release it. Ari Novak is the controller."
            />
          </Specimen>

          <Specimen id="evidence" title="Evidence" note="Dotted underlines mark figures you can open. Hover or focus shows the source.">
            <p className="max-w-[60ch] text-body leading-6">
              Eve withheld{" "}
              <Evidence source="Rule US-NRA-PRIZE v2 · 30% default">
                <Money amountMinor={38_970} />
              </Evidence>{" "}
              from the{" "}
              <Evidence source="Prize list v3 · retailer price, Oct 2">
                <Money amountMinor={129_900} />
              </Evidence>{" "}
              item value because Priya&apos;s{" "}
              <Evidence source="W-8BEN · sent Oct 25, 1:31 PM, not signed">W-8BEN</Evidence>{" "}
              lists Canada as her residence. <TruthLabel kind="unverified" className="ml-1 align-middle" />
            </p>
          </Specimen>

          <Specimen
            id="empty"
            title="Loading and empty"
            note="Loading rows keep the real row's geometry so nothing jumps. Empty states say what will appear and why the space is empty."
          >
            <InboxList label="Inbox, loading" busy>
              <InboxRowSkeleton />
              <InboxRowSkeleton />
            </InboxList>
            <div className="flex max-w-xl flex-col items-start gap-1 rounded-xl border border-dashed px-6 py-10">
              <p className="font-semibold">No holds right now</p>
              <p className="text-small text-muted-foreground">
                Payments waiting on a tax form, bank verification, or a sponsor show up here, with who Eve is chasing and when.
              </p>
            </div>
          </Specimen>
        </Section>

        <Section
          id="example"
          title="Inbox example"
          lede="The pieces together in the app's shell. Hover a row or a mark on the horizon and the two stay linked; select a row to open it beside the list."
        >
          <InboxExample />
        </Section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-small text-muted-foreground">
          <p>Eve prepares and explains. A human controller signs.</p>
          <p>Daylight · Oct 2026</p>
        </footer>
      </main>
    </div>
  );
}

function Wordmark() {
  return (
    <a href="#overview" className="flex items-baseline gap-2 rounded-md">
      <span className="text-heading">Eve</span>
      <span className="text-small text-muted-foreground">Design system</span>
    </a>
  );
}

function ButtonState({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

function Principle({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="font-semibold">{term}</dt>
      <dd className="max-w-[48ch] text-muted-foreground">{children}</dd>
    </div>
  );
}

function ratio(fg: string, bg: string) {
  return `${contrastRatio(fg, bg).toFixed(1)}:1`;
}

function ColorTable({
  tokens,
  contrast,
  sample = false,
}: {
  tokens: ColorToken[];
  contrast: (t: ColorToken) => string | null;
  sample?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {tokens.map((t) => {
        const c = contrast(t);
        return (
          <li
            key={t.name}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b py-3 first:pt-0 md:grid-cols-[2.5rem_11rem_5.5rem_minmax(0,1fr)_9rem]"
          >
            <span
              aria-hidden
              className="row-span-2 size-10 rounded-lg ring-1 ring-white/10 ring-inset md:row-span-1"
              style={{ background: t.value }}
            />
            <Code>{t.name}</Code>
            <span className="font-mono text-caption text-faint max-md:hidden">{t.value}</span>
            <span className="text-small text-muted-foreground max-md:col-start-2">
              {sample ? (
                <span className="mr-2 font-semibold" style={{ color: t.value }}>
                  Aa
                </span>
              ) : null}
              {t.role}
            </span>
            <span className="text-caption tabular-nums text-muted-foreground max-md:col-start-2 md:text-right">
              {c ?? ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-small font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-msg`} className="text-small text-critical">
          {error}
        </p>
      ) : help ? (
        <p className="text-small text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}

function MoneyRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </>
  );
}
