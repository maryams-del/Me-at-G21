"use client";
import { createContext, useContext, useId, useState } from "react";

export const RevealCtx = createContext<{ close: () => void } | null>(null);
/** True inside an EntryCard, which already shows the big countdown. */
export const InEntryCardCtx = createContext(false);
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "./api";
import { CountdownRail, TimeWheel } from "./ReminderPickers";
import { Icon, type IconName } from "./icons";
import { countdown, daysBetween } from "@/lib/countdown";
import { dmy } from "@/lib/time";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  /** intlist (days before): tap-able suggestions on the reminder rail */
  presets?: number[];
  /** intlist: the most days before / the most reminders the server accepts */
  maxDays?: number;
  maxCount?: number;
  /** intlist: count back from this date field (default: expiresOn / dueDate / dueOn / deadlineDate) */
  anchorField?: string;
  /** intlist: count back from this fixed date when the form has no date field */
  anchorDate?: string | null;
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
  /** Shows a bin button beside Save that asks before deleting the entry. */
  deleteAction?: { op: string; input: unknown; confirm: string; label?: string };
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
    // A reminder rail with nothing ticked means "no days before" (not "use the default").
    if (v === "" && f.type === "intlist" && f.negative && form.has(f.name)) {
      const prev = Array.isArray(out[key]) ? (out[key] as number[]) : [];
      out[key] = [...new Set([...prev, ...(f.includeZero ? [0] : [])])];
      continue;
    }
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

/** Date fields that the reminder rail counts back from, in order of preference. */
const ANCHOR_FIELDS = ["expiresOn", "dueDate", "dueOn", "deadlineDate"];
const DEFAULT_PRESETS = [90, 60, 30, 14, 7, 3, 1];
const REPEAT_PRESETS = [14, 7, 3, 2, 1];

function isArchiveStatus(f: FieldDef) {
  const vals = (f.options ?? []).map((o) => o.value).sort().join(",");
  return f.name === "status" && f.type === "select" && vals === "active,archived";
}

export function OpForm({ op, fields, initial = {}, fixed = {}, submitLabel, successMessage, onDone, endpoint, nestKey, nestExtra, nestBase, confirmText, danger, compact, resetOnSuccess, deleteAction }: Props) {
  const router = useRouter();
  const id = useId();
  const reveal = useContext(RevealCtx);
  const inCard = useContext(InEntryCardCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [watch, setWatch] = useState<Record<string, string>>(() => {
    const w: Record<string, string> = {};
    for (const f of fields) if (f.showIf) w[f.showIf.field] = initial[f.showIf.field] == null ? "" : String(initial[f.showIf.field]);
    return w;
  });
  const visible = (f: FieldDef) => !f.showIf || f.showIf.values.includes(watch[f.showIf.field] ?? "");
  // "Reminders on" gets its own tab; the reminder settings only show while it's on
  // (they stay in the form while hidden, so turning reminders off doesn't lose them).
  const toggle = fields.find((f) => f.type === "checkbox" && f.name === "remindersEnabled");
  const remFields = toggle ? fields.filter((f) => REMINDER_FIELDS.has(f.sendAs ?? f.name) || REMINDER_FIELDS.has(f.name)) : [];
  const [remOn, setRemOn] = useState(() => !!toggle && Boolean(initial[toggle.name]));
  const [remSummary, setRemSummary] = useState("");

  // Reminders make Active/Archived redundant: keep whatever is stored, but don't ask.
  const archiveField = toggle ? fields.find(isArchiveStatus) : undefined;
  const notesFields = toggle ? fields.filter((f) => f.name === "notes" && !remFields.includes(f)) : [];
  const detailFields = fields.filter((f) => f !== toggle && !remFields.includes(f) && !notesFields.includes(f) && f !== archiveField);
  const tabs = toggle
    ? ([["details", "Details", detailFields], ["reminders", "Reminders", [toggle, ...remFields]], ["notes", "Notes", notesFields]] as const).filter(([, , fs]) => fs.length > 0)
    : [];
  const [tab, setTab] = useState<string>(tabs[0]?.[0] ?? "details");

  // The date the reminders count back from (expiry, due date, deadline…), followed live as it's edited.
  const anchorField = fields.find((f) => f.type === "date" && f.name === fields.find((x) => x.anchorField)?.anchorField)
    ?? ANCHOR_FIELDS.map((n) => fields.find((f) => f.type === "date" && f.name === n)).find(Boolean);
  const fixedAnchor = fields.find((f) => f.anchorDate)?.anchorDate ?? null;
  const [anchor, setAnchor] = useState<string>(() => (anchorField && typeof initial[anchorField.name] === "string" ? String(initial[anchorField.name]) : fixedAnchor ?? ""));
  const anchorLabel = (anchorField?.label ?? "Due date").replace(/ date$/i, "").replace(/^Due$/, "Due");
  const today = todayStr();
  const left = anchor ? daysBetween(today, anchor) : null;
  const cd = toggle && left !== null && Number.isFinite(left) ? countdown(left, anchorField?.name === "expiresOn" || fixedAnchor ? "expiry" : anchorField?.name === "deadlineDate" ? "deadline" : "due") : null;

  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      const field = err instanceof ApiError ? err.field : undefined;
      setError({ message: err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again — nothing was changed.", field });
      const home = field ? tabs.find(([, , fs]) => (fs as readonly FieldDef[]).some((f) => f.name === field || f.sendAs === field)) : undefined;
      if (home) setTab(home[0]);
    } finally { setBusy(false); }
  }

  async function doDelete() {
    if (!deleteAction) return;
    setDeleting(true);
    try {
      const r = await api<{ message?: string }>(`/api/ops/${deleteAction.op}`, deleteAction.input);
      toast(r.message ?? "Deleted");
      reveal?.close();
      router.refresh();
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Couldn't delete. Nothing was changed." });
      setConfirmDel(false);
    } finally { setDeleting(false); }
  }

  const val = (f: FieldDef) => {
    const v = initial[f.name];
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return (f.negative ? v.map((x) => Math.abs(Number(x))).filter((x) => !(f.includeZero && x === 0)) : v).join(", ");
    return String(v);
  };

  const rich = tabs.length > 0 || !!deleteAction;
  return (
    <form onSubmit={submit} className={compact ? "grid gap-3" : "grid gap-4"} noValidate
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (toggle && t.name === toggle.name) setRemOn(t.checked);
        if (anchorField && t.name === anchorField.name) setAnchor(t.value);
        if (t.name && t.name in watch) setWatch((w) => ({ ...w, [t.name]: t.value }));
      }}>
      {cd && !inCard && (
        <div className="due-well">
          <div className="grid gap-0.5"><span className="t-label">{anchorLabel}</span><span className="font-semibold">{dmy(anchor)}</span></div>
          <div className={`entry-count ${cd.tone}`}><span className="n" style={{ fontSize: "2.4rem" }}>{cd.n}</span><span className="u">{cd.unit}</span></div>
        </div>
      )}
      {archiveField && <input type="hidden" name={archiveField.name} value={String(initial[archiveField.name] ?? "active")} />}
      {tabs.length > 1 && (
        <div className="seg-tabs" role="tablist" aria-label="Sections">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel-${key}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      )}
      {tabs.length ? tabs.map(([key, , fs]) => (
        <div key={key} role={tabs.length > 1 ? "tabpanel" : undefined} id={`${id}-panel-${key}`} aria-labelledby={tabs.length > 1 ? `${id}-tab-${key}` : undefined} hidden={tabs.length > 1 && tab !== key}>
          {key === "reminders" ? reminderBox() : (
            <div className={fs.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
              {(fs as readonly FieldDef[]).filter(visible).map((f) => renderField(f))}
            </div>
          )}
        </div>
      )) : (
        <div className={fields.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
          {fields.filter(visible).map((f) => renderField(f))}
        </div>
      )}
      {error && <p role="alert" className="error">{error.message}</p>}
      {!rich ? (
        <div><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
      ) : confirmDel && deleteAction ? (
        <div role="alertdialog" aria-labelledby={`${id}-delq`} className="confirm-box preview-enter">
          <p id={`${id}-delq`} className="font-semibold">{deleteAction.confirm}</p>
          <p className="t-small text-ink-2">You can’t undo this.</p>
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={() => setConfirmDel(false)} autoFocus>Keep it</button>
            <button type="button" className="btn flex-1 btn-delete" disabled={deleting} onClick={doDelete}>{deleting ? "Deleting…" : "Yes, delete"}</button>
          </div>
        </div>
      ) : (
        <div className="form-foot">
          {deleteAction && (
            <button type="button" className="trash-btn" aria-label={deleteAction.label ?? "Delete this entry"} title={deleteAction.label ?? "Delete"} onClick={() => setConfirmDel(true)}>
              <Icon name="trash" size={18} />
            </button>
          )}
          <button className={`btn flex-1 ${danger ? "btn-danger" : "btn-primary"}`} style={{ minHeight: 48 }} disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        </div>
      )}
    </form>
  );

  function reminderBox() {
    if (!toggle) return null;
    const others = remFields.filter(visible);
    return (
      <div key="__reminders" className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${id}-${toggle.name}`} className="grid gap-0.5 cursor-pointer">
            <span className="font-semibold">Reminders</span>
            <span className="t-meta">{remOn ? remSummary || "On" : "Off"}</span>
          </label>
          <input type="checkbox" role="switch" className="switch" id={`${id}-${toggle.name}`} name={toggle.name} defaultChecked={Boolean(initial[toggle.name])} />
        </div>
        <div className={remOn ? "grid gap-4 preview-enter" : "hidden"}>
          {others.map((f) => renderField(f, true))}
        </div>
      </div>
    );
  }

  function renderField(f: FieldDef, inReminders = false) {
          {
          const fid = `${id}-${f.name}`;
          const invalid = error?.field === f.name;
          const common = { id: fid, name: f.name, required: f.required, "aria-invalid": invalid || undefined, "aria-describedby": f.help ? `${fid}-h` : undefined };
          if (f === archiveField) return null;
          if (f.type === "intlist" && f.negative) return (
            <div key={f.name} className="field sm:col-span-2" role="group" aria-labelledby={`${fid}-l`}>
              <span id={`${fid}-l`} className="label">{f.label.replace(/ this many days/, "").replace(/ \(0 = on the day\)/, "")}</span>
              <CountdownRail name={f.name} initial={initial[f.name]} anchor={fixedAnchor ?? anchor} endLabel={anchorField ? anchorLabel : "The day"}
                presets={f.presets ?? (anchorField || fixedAnchor ? DEFAULT_PRESETS : REPEAT_PRESETS)} includeZero={f.includeZero}
                maxDays={f.maxDays} maxCount={f.maxCount} onSummary={setRemSummary} />
            </div>
          );
          if (f.type === "time") return inReminders ? (
            <div key={f.name} className="flex items-center justify-between gap-3 rule-t pt-4 sm:col-span-2">
              <span className="grid gap-0.5"><span className="font-semibold">{f.label}</span><span className="t-meta">Same time for each one</span></span>
              <TimeWheel name={f.name} initial={initial[f.name]} nullable={f.nullable || !f.required} label={f.label} />
            </div>
          ) : (
            <div key={f.name} className="field" role="group" aria-labelledby={`${fid}-l`}>
              <span id={`${fid}-l`} className="label">{f.label}{f.required ? "" : <span className="t-meta"> (optional)</span>}</span>
              <TimeWheel name={f.name} initial={initial[f.name]} nullable={f.nullable || !f.required} label={f.label} />
              {f.help && <span className="t-meta">{f.help}</span>}
            </div>
          );
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
                  type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
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
export function OpButton({ op, input, label, className = "btn", confirmText, successMessage, ariaLabel, icon }: { op: string; input: unknown; label: string; className?: string; confirmText?: string; successMessage?: string; ariaLabel?: string; icon?: IconName }) {
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
    }}>{icon && <Icon name={icon} size={15} />}{busy ? "Saving…" : label}</button>
  );
}

/** Labels that add something new get the round "+" add button. */
const ADD_LABEL = /^(\+\s*)?(add|log|new|track)\b/i;

export function PlusIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>;
}

/** Disclosure wrapper for “add” forms so tracker pages stay calm. */
export function Reveal({ label, children, open: initialOpen = false, buttonClass = "btn", iconOnly = false, icon }: { label: string; children: React.ReactNode; open?: boolean; buttonClass?: string; iconOnly?: boolean; icon?: IconName }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  const isAdd = ADD_LABEL.test(label);
  const text = label.replace(/^\+\s*/, "");
  return (
    <div className={iconOnly ? "contents" : open ? "basis-full w-full min-w-0" : undefined}>
      {iconOnly ? (
        <button type="button" className="plus-btn" aria-label={open ? "Close" : text} title={text} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <PlusIcon size={22} />
        </button>
      ) : icon ? (
        <button type="button" className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Icon name={open ? "close" : icon} size={15} />{open ? "Close" : label}</button>
      ) : isAdd ? (
        <button type="button" className={`btn add-btn ${buttonClass.includes("btn-sm") ? "btn-sm" : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className="add-ico"><PlusIcon size={buttonClass.includes("btn-sm") ? 15 : 18} /></span>{open ? "Close" : text}
        </button>
      ) : (
        <button type="button" className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close" : label}</button>
      )}
      {open && <div id={id} className={`mt-2 panel p-4 preview-enter ${iconOnly ? "basis-full w-full min-w-0 order-last" : ""}`}><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider></div>}
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
