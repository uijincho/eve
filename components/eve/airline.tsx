import { cn } from "cn";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";

/** Carrier names as they appear on receipts and fare tables, to IATA codes. Logos live in public/airlines. */
const IATA: Record<string, string> = {
  "air canada": "AC",
  "air france": "AF",
  aeromexico: "AM",
  "aeroméxico": "AM",
  alaska: "AS",
  "alaska airlines": "AS",
  jetblue: "B6",
  "british airways": "BA",
  delta: "DL",
  "delta air lines": "DL",
  "korean air": "KE",
  latam: "LA",
  "latam airlines": "LA",
  lufthansa: "LH",
  swiss: "LX",
  ana: "NH",
  "all nippon airways": "NH",
  porter: "PD",
  qantas: "QF",
  united: "UA",
  "united airlines": "UA",
  "virgin atlantic": "VS",
  westjet: "WS",
};

export function airlineCode(name: string | undefined): string | undefined {
  return name ? IATA[name.trim().toLowerCase()] : undefined;
}

/**
 * An airline as its logo on a white tile, named on hover and to screen
 * readers. Carriers without a logo fall back to their name in a pill.
 */
export function Airline({ name, withName = false, className }: { name: string; withName?: boolean; className?: string }) {
  const code = airlineCode(name);
  if (!code) {
    return withName ? <span className={className}>{name}</span> : <Badge variant="outline" className={className}>{name}</Badge>;
  }
  const logo = <Image src={`/airlines/${code}.svg`} alt={withName ? "" : name} width={20} height={20} unoptimized className={withName ? "size-4 object-contain" : "size-5 object-contain"} />;
  if (withName) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {logo}
        {name}
      </span>
    );
  }
  return (
    <span title={name} className={cn("inline-flex h-6 items-center rounded-full border bg-surface px-2", className)}>
      {logo}
    </span>
  );
}

/** An airport code as a pill: "YYZ". */
export function Airport({ code, className }: { code: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-6 bg-surface px-2.5 tracking-wide tabular-nums", className)}>
      {code}
    </Badge>
  );
}
