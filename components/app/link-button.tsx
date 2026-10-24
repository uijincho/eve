import Link from "next/link";

import { Button } from "@/components/ui/button";

type Props = Omit<React.ComponentProps<typeof Button>, "render" | "nativeButton"> & {
  href: string;
  external?: boolean;
};

/** A button-styled link. Downloads and exports use `external`. */
export function LinkButton({ href, external, children, ...props }: Props) {
  return (
    <Button
      nativeButton={false}
      render={external ? <a href={href} /> : <Link href={href} />}
      {...props}
    >
      {children}
    </Button>
  );
}
