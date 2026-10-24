import { cn } from "cn";

/** Page title, one-line lede, and the page's actions on the right. */
export function PageHeader({
  title,
  lede,
  actions,
  children,
  className,
}: {
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 border-b px-4 pt-5 pb-4 sm:px-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title">{title}</h1>
          {lede ? <p className="max-w-[72ch] text-small text-muted-foreground">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** A section within a page, with a hairline above it. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-subheading">{title}</h2>
        {aside ? <div className="text-small text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
