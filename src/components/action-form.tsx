"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/web/action-result";

/**
 * Form that calls a server action without resetting the fields. React resets uncontrolled
 * <form action> after each submit, which would drop what the user typed on a validation error,
 * so submission is handled here. Field errors arrive already translated from the server.
 */
type Action = (formData: FormData) => Promise<ActionResult>;

const FormContext = createContext<{ errors: Record<string, string> }>({ errors: {} });

export function ActionForm(props: {
  action: Action;
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  /** After success: "refresh" re-renders the page; a redirectTo from the server navigates. */
  onSuccess?: "refresh" | "none";
  /** Reset fields after success (for "add another" style forms). */
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [nonce, setNonce] = useState(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const next = await props.action(data);
      setResult(next);
      setNonce((n) => n + 1);
      if (next.ok) {
        if (props.resetOnSuccess) form.reset();
        if (next.redirectTo) router.push(next.redirectTo);
        else if (props.onSuccess === "refresh") router.refresh();
      }
    });
  }

  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  return (
    <FormContext.Provider value={{ errors }}>
      <form onSubmit={onSubmit} className={props.className} aria-label={props.ariaLabel} noValidate aria-busy={pending || undefined}>
        {result && (
          <div key={nonce} className={`notice ${result.ok ? "ok" : "error"}`} role={result.ok ? "status" : "alert"} tabIndex={-1}>
            <span className="icon" aria-hidden="true">{result.ok ? "✓" : "!"}</span>
            <span>{result.message}</span>
          </div>
        )}
        <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {props.children}
        </fieldset>
      </form>
    </FormContext.Provider>
  );
}

export function useFieldError(name: string): string | undefined {
  return useContext(FormContext).errors[name];
}

export function ErrorText({ id, name }: { id: string; name: string }) {
  const error = useFieldError(name);
  if (!error) return null;
  return (
    <span id={id} className="error">
      {error}
    </span>
  );
}
