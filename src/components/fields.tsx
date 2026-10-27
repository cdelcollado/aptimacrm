"use client";

import { useId } from "react";
import { ErrorText, useFieldError } from "@/components/action-form";

/** Labelled inputs wired to the form's field errors (aria-invalid and aria-describedby). */

interface BaseProps {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string | number | null;
}

function useDescribedBy(name: string, hint?: string) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const hasError = Boolean(useFieldError(name));
  const describedBy = [hintId, hasError ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return { id, hintId, errorId, describedBy, invalid: hasError };
}

export function TextField(props: BaseProps & { type?: "text" | "email" | "password" | "date" | "datetime-local" | "number" | "search" | "file" | "tel"; autoComplete?: string; inputMode?: "text" | "decimal" | "numeric" | "email" | "tel" | "search"; placeholder?: string; accept?: string; maxLength?: number }) {
  const { id, hintId, errorId, describedBy, invalid } = useDescribedBy(props.name, props.hint);
  return (
    <div className="field">
      <label htmlFor={id}>
        {props.label}
        {props.required ? <span className="muted"> *</span> : null}
      </label>
      {props.hint && <span id={hintId} className="hint">{props.hint}</span>}
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? undefined}
        required={props.required}
        aria-required={props.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        accept={props.accept}
        maxLength={props.maxLength}
      />
      <ErrorText id={errorId} name={props.name} />
    </div>
  );
}

export function TextAreaField(props: BaseProps & { rows?: number; maxLength?: number }) {
  const { id, hintId, errorId, describedBy, invalid } = useDescribedBy(props.name, props.hint);
  return (
    <div className="field">
      <label htmlFor={id}>
        {props.label}
        {props.required ? <span className="muted"> *</span> : null}
      </label>
      {props.hint && <span id={hintId} className="hint">{props.hint}</span>}
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 4}
        defaultValue={props.defaultValue ?? undefined}
        required={props.required}
        aria-required={props.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={props.maxLength}
      />
      <ErrorText id={errorId} name={props.name} />
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField(props: BaseProps & { options: Option[]; emptyLabel?: string }) {
  const { id, hintId, errorId, describedBy, invalid } = useDescribedBy(props.name, props.hint);
  return (
    <div className="field">
      <label htmlFor={id}>
        {props.label}
        {props.required ? <span className="muted"> *</span> : null}
      </label>
      {props.hint && <span id={hintId} className="hint">{props.hint}</span>}
      <select
        id={id}
        name={props.name}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      >
        {props.emptyLabel !== undefined && <option value="">{props.emptyLabel}</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ErrorText id={errorId} name={props.name} />
    </div>
  );
}
