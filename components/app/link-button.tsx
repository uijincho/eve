import Link from "next/link";
import type { VariantProps } from "class-variance-authority";

import { buttonVariants } from "@/components/ui/button";

type Props = Omit<React.ComponentProps<"a">, "href"> & VariantProps<typeof buttonVariants> & {
  href: string;
  /** Downloads, exports, and documents: a plain anchor, not a client route. */
  external?: boolean;
  target?: string;
};

/** A button-styled link. */
export function LinkButton({ href, external, target, children, className, variant, size, rel, ...props }: Props) {
  const common = { ...props, target, rel: rel ?? (target ? "noreferrer" : undefined), className: buttonVariants({ variant, size, className }), "data-slot": "button" };
  return external ? <a {...common} href={href}>{children}</a> : <Link {...common} href={href}>{children}</Link>;
}
