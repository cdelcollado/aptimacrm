import type { ReactNode } from "react";

/** Server-rendered notice from a redirect query (?ok= or ?err=). Errors use role=alert. */
export function Notice({ kind, children }: { kind: "ok" | "error" | "warn" | "info"; children: ReactNode }) {
  const icon = kind === "ok" ? "✓" : kind === "info" ? "i" : "!";
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"} tabIndex={-1}>
      <span className="icon" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
