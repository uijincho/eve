import Link from "next/link";

import { Button } from "@/components/ui/button";

type Props = Omit<React.ComponentProps<typeof Button>, "render" | "nativeButton"> & {
  href: string;
  /** Downloads, exports, and documents: a plain anchor, not a client route. */
  external?: boolean;
  target?: string;
};

/** A button-styled link. */
export function LinkButton({ href, external, target, children, ...props }: Props) {
  return (
    <Button
      nativeButton={false}
      render={
        external ? (
          <a href={href} target={target} rel={target ? "noreferrer" : undefined} />
        ) : (
          <Link href={href} />
        )
      }
      {...props}
    >
      {children}
    </Button>
  );
}
