"use client";
import { createContext, useContext, useId, useState } from "react";

const RevealCtx = createContext<{ close: () => void } | null>(null);
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "./api";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "amount" | "int" | "date" | "time" | "select" | "textarea" | "checkbox" | "intlist" | "datetime";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** keep empty values as null instead of omitting */
  nullable?: boolean;
  /** intlist: store as negative "days before" offsets (0 = on the day) */
  negative?: boolean;
  /** intlist: always include 0 (remind on the day itself) */
  includeZero?: boolean;
  /** select whose value should be sent as a number */
  numeric?: boolean;
  wide?: boolean;
};

type Props = {
  op: string;
  fields: FieldDef[];
  initial?: Record<string, unknown>;
  fixed?: Record<string, unknown>;
  submitLabel: string;
  successMessage?: string;
  onDone?: () => void;
  /** Use a custom endpoint instead of /api/ops/<op> (e.g. resolving a draft). */
  endpoint?: string;
  /** Send `{ ...nestExtra, [nestKey]: { ...nestBase, ...input } }` instead of the bare input (e.g. resolving a draft). */
  nestKey?: string;
  nestExtra?: Record<string, unknown>;
  nestBase?: Record<string, unknown>;
  confirmText?: string;
  danger?: boolean;
  compact?: boolean;
};

function toInput(fields: FieldDef[], form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "checkbox") { out[f.name] = form.get(f.name) === "on"; continue; }
    const v = String(form.get(f.name) ?? "").trim();
    if (v === "") { if (f.nullable) out[f.name] = null; continue; }
    if (f.type === "int") out[f.name] = Number(v);
    else if (f.type === "intlist") {
      let xs = v.split(/[\s,]+/).filter(Boolean).map(Number);
      if (f.negative) xs = xs.map((n) => -Math.abs(n));
      if (f.includeZero && !xs.includes(0)) xs.push(0);
      out[f.name] = [...new Set(xs)];
    }
    else if (f.numeric) out[f.name] = Number(v);
    else if (f.type === "datetime") out[f.name] = new Date(v).toISOString();
    else if (f.type === "amount") out[f.name] = v.replace(/,/g, "");
    else out[f.name] = v;
  }
  return out;
}

export function OpForm({ op, fields, initial = {}, fixed = {}, submitLabel, successMessage, onDone, endpoint, nestKey, nestExtra, nestBase, confirmText, danger, compact }: Props) {
  const router = useRouter();
  const id = useId();
  const reveal = useContext(RevealCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    const input = { ...toInput(fields, new FormData(e.currentTarget)), ...fixed };
    try {
      const body = nestKey ? { ...nestExtra, [nestKey]: { ...nestBase, ...input } } : input;
      const res = await api<{ message?: string }>(endpoint ?? `/api/ops/${op}`, body);
      toast(successMessage ?? res.message ?? "Saved");
      onDone?.();
      reveal?.close();
      router.refresh();
    } catch (err) {
      setError({ message: err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again — nothing was changed.", field: err instanceof ApiError ? err.field : undefined });
    } finally { setBusy(false); }
  }

  const val = (f: FieldDef) => {
    const v = initial[f.name];
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return (f.negative ? v.map((x) => Math.abs(Number(x))).filter((x) => !(f.includeZero && x === 0)) : v).join(", ");
    return String(v);
  };

  return (
    <form onSubmit={submit} className={compact ? "grid gap-3" : "grid gap-4"} noValidate>
      <div className={fields.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {fields.map((f) => {
          const fid = `${id}-${f.name}`;
          const invalid = error?.field === f.name;
          const common = { id: fid, name: f.name, required: f.required, "aria-invalid": invalid || undefined, "aria-describedby": f.help ? `${fid}-h` : undefined };
          if (f.type === "checkbox") return (
            <label key={f.name} className={`check ${f.wide ? "sm:col-span-2" : ""}`}>
              <input type="checkbox" {...common} defaultChecked={initial[f.name] === undefined ? false : Boolean(initial[f.name])} />
              <span>{f.label}</span>
            </label>
          );
          return (
            <label key={f.name} htmlFor={fid} className={`field ${f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}`}>
              <span className="label">{f.label}{f.required ? "" : <span className="t-meta"> (optional)</span>}</span>
              {f.type === "select" ? (
                <select className="select" {...common} defaultValue={val(f)}>
                  {!f.required && <option value="">—</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "textarea" ? (
                <textarea className="textarea" {...common} defaultValue={val(f)} placeholder={f.placeholder} />
              ) : (
                <input className="input" {...common} defaultValue={val(f)} placeholder={f.placeholder}
                  type={f.type === "date" ? "date" : f.type === "time" ? "time" : f.type === "datetime" ? "datetime-local" : "text"}
                  inputMode={f.type === "amount" ? "decimal" : f.type === "int" ? "numeric" : undefined} />
              )}
              {f.help && <span id={`${fid}-h`} className="t-meta">{f.help}</span>}
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="error">{error.message}</p>}
      <div><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
    </form>
  );
}

/** Close the surrounding <Reveal> panel, if any (for custom forms). */
export function useRevealClose() {
  return useContext(RevealCtx)?.close;
}

/** One-tap op button (e.g. “Waxing completed today”). */
export function OpButton({ op, input, label, className = "btn", confirmText, successMessage, ariaLabel }: { op: string; input: unknown; label: string; className?: string; confirmText?: string; successMessage?: string; ariaLabel?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className={className} disabled={busy} aria-label={ariaLabel} onClick={async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      setBusy(true);
      try {
        const r = await api<{ message?: string }>(`/api/ops/${op}`, input);
        toast(successMessage ?? r.message ?? "Saved");
        router.refresh();
      } catch (e) { toast(e instanceof Error ? e.message : "Couldn't save", "error"); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : label}</button>
  );
}

/** Disclosure wrapper for “add” forms so tracker pages stay calm. */
export function Reveal({ label, children, open: initialOpen = false, buttonClass = "btn" }: { label: string; children: React.ReactNode; open?: boolean; buttonClass?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return (
    <div>
      <button className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close" : label}</button>
      {open && <div id={id} className="mt-4 panel p-4 preview-enter"><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider></div>}
    </div>
  );
}
