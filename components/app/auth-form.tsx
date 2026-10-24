"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Field } from "@/components/app/field";
import { ResultText } from "@/components/app/result-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/client/api";
import { auth } from "@/lib/client/account";

const MIN_PASSWORD = 12;

/**
 * Email and password sign-in or account creation (Better Auth). Calls
 * onSignedIn once the session cookie is set; the caller decides where to go.
 */
export function AuthForm({
  initialMode = "sign-in",
  emailHint,
  onSignedIn,
}: {
  initialMode?: "sign-in" | "sign-up";
  /** Shown under the email field, e.g. the masked address an invite went to. */
  emailHint?: string;
  onSignedIn: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const signUp = mode === "sign-up";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const next: Record<string, string> = {};
    if (signUp && !name.trim()) next.name = "Enter your name as it appears on your ID.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter an email address like dana@example.org.";
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) {
      (next.name ? nameRef : next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setPending(true);
    try {
      if (signUp) await auth.signUp(name.trim(), email.trim(), password);
      else await auth.signIn(email.trim(), password);
      await onSignedIn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setFailure(
        !signUp && (status === 401 || status === 400)
          ? "That email and password do not match an account."
          : err instanceof ApiError
            ? err.message
            : "Eve could not be reached. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {signUp ? (
        <Field label="Full name" error={errors.name}>
          {(p) => <Input {...p} ref={nameRef} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      ) : null}
      <Field label="Email" error={errors.email} help={emailHint}>
        {(p) => <Input {...p} ref={emailRef} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Password" error={errors.password} help={signUp ? `At least ${MIN_PASSWORD} characters.` : undefined}>
        {(p) => (
          <Input
            {...p}
            ref={passwordRef}
            type="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" aria-busy={pending || undefined}>
          {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {pending ? (signUp ? "Creating account" : "Signing in") : signUp ? "Create account" : "Sign in"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setMode(signUp ? "sign-in" : "sign-up");
            setErrors({});
            setFailure(null);
          }}
          className="rounded-md text-small text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {signUp ? "I already have an account" : "Create an account"}
        </button>
      </div>
      <span role="status" aria-live="polite">
        {failure ? <ResultText result={{ ok: false, message: failure }} /> : null}
      </span>
    </form>
  );
}
