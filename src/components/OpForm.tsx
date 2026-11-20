"use client";
import { createContext, useContext, useId, useState } from "react";

const RevealCtx = createContext<{ close: () => void } | null>(null);
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "./api";

/** Fields that only matter when reminders are on. */
const REMINDER_FIELDS = new Set(["reminderOffsetsDays", "reminderTime", "reminderDayOfMonth", "reminderLeadMinutes", "overdueRepeatDays", "trialOffsetsDays"]);

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "amount" | "int" | "date" | "time" | "select" | "textarea" | "checkbox" | "intlist" | "datetime" | "checks" | "interval";
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
  /** textarea: send as an array of non-empty lines */
  lines?: boolean;
  /** send the value as a one-item array (or [] when empty) */
  asArray?: boolean;
  /** send under a different key */
  sendAs?: string;
  wide?: boolean;
  /** text/int: suggestions shown as you type (you can still type anything) */
  suggestions?: string[];
  /** only show this field while another field has one of these values */
  showIf?: { field: string; values: string[] };
  /** interval: "Every [n] [unit]" — `name` holds the number, `unitName` the unit chosen from `options` */
  unitName?: string;
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
  /** Clear the fields after a successful save (for quick-add forms). */
  resetOnSuccess?: boolean;
};

function toInput(fields: FieldDef[], form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.sendAs ?? f.name;
    if (f.lines || f.asArray) {
      const raw = String(form.get(f.name) ?? "");
      out[key] = f.lines ? raw.split("\n").map((l) => l.trim()).filter(Boolean) : raw.trim() ? [raw.trim()] : [];
      continue;
    }
    if (f.type === "checkbox") { out[f.name] = form.get(f.name) === "on"; continue; }
    if (f.type === "checks") { out[key] = form.getAll(f.name).map(String); continue; }
    if (f.type === "interval") {
      if (!form.has(f.name)) continue;
      const n = String(form.get(f.name) ?? "").trim();
      if (n) out[f.name] = Number(n);
      if (f.unitName) out[f.unitName] = String(form.get(f.unitName) ?? "");
      continue;
    }
    const v = String(form.get(f.name) ?? "").trim();
    if (v === "") { if (f.nullable) out[f.name] = null; continue; }
    if (f.type === "int") out[f.name] = Number(v);
    else if (f.type === "intlist") {
      let xs = v.split(/[\s,]+/).filter(Boolean).map(Number);
      if (f.negative) xs = xs.map((n) => -Math.abs(n));
      if (f.includeZero && !xs.includes(0)) xs.push(0);
      const prev = Array.isArray(out[key]) ? (out[key] as number[]) : [];
      out[key] = [...new Set([...prev, ...xs])]; // fields sharing a sendAs key are merged
    }
    else if (f.numeric) out[f.name] = Number(v);
    else if (f.type === "datetime") out[f.name] = new Date(v).toISOString();
    else if (f.type === "amount") out[f.name] = v.replace(/,/g, "");
    else out[f.name] = v;
  }
  return out;
}

export function OpForm({ op, fields, initial = {}, fixed = {}, submitLabel, successMessage, onDone, endpoint, nestKey, nestExtra, nestBase, confirmText, danger, compact, resetOnSuccess }: Props) {
  const router = useRouter();
  const id = useId();
  const reveal = useContext(RevealCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [watch, setWatch] = useState<Record<string, string>>(() => {
    const w: Record<string, string> = {};
    for (const f of fields) if (f.showIf) w[f.showIf.field] = initial[f.showIf.field] == null ? "" : String(initial[f.showIf.field]);
    return w;
  });
  const visible = (f: FieldDef) => !f.showIf || f.showIf.values.includes(watch[f.showIf.field] ?? "");
  // "Reminders on" goes first in its own box; the reminder settings only appear while it's ticked
  // (they stay in the form while hidden, so turning reminders off doesn't lose them).
  const toggle = fields.find((f) => f.type === "checkbox" && f.name === "remindersEnabled");
  const remFields = toggle ? fields.filter((f) => REMINDER_FIELDS.has(f.sendAs ?? f.name) || REMINDER_FIELDS.has(f.name)) : [];
  const [remOn, setRemOn] = useState(() => !!toggle && Boolean(initial[toggle.name]));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    const form = e.currentTarget;
    const input = { ...toInput(fields.filter(visible), new FormData(form)), ...fixed };
    try {
      const body = nestKey ? { ...nestExtra, [nestKey]: { ...nestBase, ...input } } : input;
      const res = await api<{ message?: string }>(endpoint ?? `/api/ops/${op}`, body);
      toast(successMessage ?? res.message ?? "Saved");
      if (resetOnSuccess) form.reset();
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
    <form onSubmit={submit} className={compact ? "grid gap-3" : "grid gap-4"} noValidate
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (toggle && t.name === toggle.name) setRemOn(t.checked);
        if (t.name && t.name in watch) setWatch((w) => ({ ...w, [t.name]: t.value }));
      }}>
      <div className={fields.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {fields.filter(visible).filter((f) => f !== toggle && !remFields.includes(f)).flatMap((f, i, arr) => {
          // Put the reminders box where the first reminder field used to be (or at the end).
          const firstRem = remFields.length ? fields.indexOf(remFields[0]) : toggle ? fields.indexOf(toggle) : -1;
          const box = toggle && (fields.indexOf(f) > firstRem && (i === 0 || fields.indexOf(arr[i - 1]) < firstRem)) ? [reminderBox()] : [];
          return [...box, renderField(f)];
        })}
        {toggle && fields.filter(visible).filter((f) => f !== toggle && !remFields.includes(f)).every((f) => fields.indexOf(f) < (remFields.length ? fields.indexOf(remFields[0]) : fields.indexOf(toggle))) && reminderBox()}
      </div>
      {error && <p role="alert" className="error">{error.message}</p>}
      <div><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
    </form>
  );

  function reminderBox() {
    if (!toggle) return null;
    return (
      <div key="__reminders" className="sm:col-span-2 rounded-[16px] p-3 grid gap-3" style={{ border: "1px solid var(--hair)", background: "color-mix(in srgb, var(--field-bg) 60%, transparent)" }}>
        <label className="check">
          <input type="checkbox" id={`${id}-${toggle.name}`} name={toggle.name} defaultChecked={Boolean(initial[toggle.name])} />
          <span className="font-semibold">{toggle.label}</span>
        </label>
        <div className={remOn ? "grid gap-4 sm:grid-cols-2 preview-enter" : "hidden"}>
          {remFields.map((f) => renderField(f))}
        </div>
      </div>
    );
  }

  function renderField(f: FieldDef) {
          {
          const fid = `${id}-${f.name}`;
          const invalid = error?.field === f.name;
          const common = { id: fid, name: f.name, required: f.required, "aria-invalid": invalid || undefined, "aria-describedby": f.help ? `${fid}-h` : undefined };
          if (f.type === "checkbox") return (
            <label key={f.name} className={`check ${f.wide ? "sm:col-span-2" : ""}`}>
              <input type="checkbox" {...common} defaultChecked={initial[f.name] === undefined ? false : Boolean(initial[f.name])} />
              <span>{f.label}</span>
            </label>
          );
          if (f.type === "checks") {
            const chosen = Array.isArray(initial[f.name]) ? (initial[f.name] as string[]) : [];
            return (
              <fieldset key={f.name} className="field sm:col-span-2">
                <legend className="label mb-1">{f.label}{f.required ? "" : <span className="t-meta"> (optional)</span>}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {f.options?.map((o) => (
                    <label key={o.value} className="check"><input type="checkbox" name={f.name} value={o.value} defaultChecked={chosen.includes(o.value)} /><span>{o.label}</span></label>
                  ))}
                </div>
              </fieldset>
            );
          }
          if (f.type === "interval") return (
            <fieldset key={f.name} className="field min-w-0">
              <legend className="label mb-1">{f.label}</legend>
              <div className="interval-row">
                <input className="input" {...common} aria-label={`${f.label} (number)`} defaultValue={val(f) || "1"} inputMode="numeric" />
                <select className="select" name={f.unitName} aria-label={`${f.label} (unit)`} defaultValue={f.unitName && initial[f.unitName] != null ? String(initial[f.unitName]) : f.options?.[0]?.value}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </fieldset>
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
                  inputMode={f.type === "amount" ? "decimal" : f.type === "int" ? "numeric" : undefined}
                  list={f.suggestions?.length ? `${fid}-l` : undefined} autoComplete={f.suggestions?.length ? "off" : undefined} />
              )}
              {!!f.suggestions?.length && <datalist id={`${fid}-l`}>{f.suggestions.map((x) => <option key={x} value={x} />)}</datalist>}
              {f.help && <span id={`${fid}-h`} className="t-meta">{f.help}</span>}
            </label>
          );
          }
  }
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
    <div className={open ? "basis-full w-full min-w-0" : undefined}>
      <button type="button" className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close" : label}</button>
      {open && <div id={id} className="mt-4 panel p-4 preview-enter"><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider></div>}
    </div>
  );
}

/**
 * The one way to edit an entry, used across the app: an "Edit" button that opens the form inline under the entry.
 * Saving (any OpForm inside) closes it again. No URL change, so Back leaves the page instead of closing the form.
 */
export function EditPanel({ children, label = "Edit", buttonClass = "btn btn-sm btn-ghost" }: { children: React.ReactNode; label?: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={open ? "col-span-full basis-full w-full min-w-0" : "min-w-0"}>
      <button type="button" className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close" : label}</button>
      {open && <div id={id} className="mt-3 panel p-4 grid gap-3 preview-enter"><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider></div>}
    </div>
  );
}
