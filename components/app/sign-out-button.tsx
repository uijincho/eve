"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/client/account";

/** Ends a real account session. Demo personas switch instead. */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      aria-busy={pending || undefined}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        await auth.signOut().catch(() => null);
        router.replace("/login");
      }}
    >
      <LogOutIcon aria-hidden />
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}
