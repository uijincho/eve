import { cn } from "cn";

export function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 border-t pt-14 pb-6 lg:scroll-mt-6"
    >
      <h2 id={`${id}-title`} className="text-title">
        {title}
      </h2>
      {lede ? (
        <p className="mt-2 max-w-[62ch] text-muted-foreground">{lede}</p>
      ) : null}
      <div className="mt-10 flex flex-col gap-14">{children}</div>
    </section>
  );
}

export function Specimen({
  id,
  title,
  note,
  className,
  children,
}: {
  id?: string;
  title: string;
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={cn("flex scroll-mt-20 flex-col gap-5 lg:scroll-mt-6", className)}>
      <div className="flex flex-col gap-1">
        <h3 className="text-subheading">{title}</h3>
        {note ? (
          <p className="max-w-[62ch] text-small text-muted-foreground">{note}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-caption text-muted-foreground">{children}</code>
  );
}
