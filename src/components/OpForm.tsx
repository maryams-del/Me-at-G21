"use client";
import { askConfirm, askConfirmFor } from "./ConfirmDialog";
import { createContext, useContext, useId, useState } from "react";

export const RevealCtx = createContext<{ close: () => void } | null>(null);
/** True inside an EntryCard, which already shows the big countdown. */
export const InEntryCardCtx = createContext(false);
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "./api";
import { CountdownRail, TimeWheel } from "./ReminderPickers";
import { Icon, type IconName } from "./icons";
import { Dropdown, GlyphSelect } from "./GlyphSelect";
import { titleCaseInput } from "@/lib/titlecase";
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
  type?: "text" | "amount" | "int" | "date" | "time" | "select" | "textarea" | "checkbox" | "intlist" | "datetime" | "checks" | "interval" | "glyph";
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
  /** shown under the field when a required field is left empty */
  requiredMessage?: string;
  /** capitalise each word as it is typed (on by default for name / label / title fields) */
  titleCase?: boolean;
  /** fields sharing a `row` sit side by side on one line, on every screen size (e.g. name + icon) */
  row?: string;
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
  /** Runs after a successful save, with what the server sent back (e.g. the new id). */
  onDone?: (res: { id?: string | null; message?: string }) => void;
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
  deleteAction?: { op: string; input: unknown; confirm: string; label?: string; /** shown under the question (default: "You can’t undo this.") */ note?: string; /** a labelled button beside Save instead of the bin icon */ asButton?: boolean; /** go here after deleting (e.g. the page itself is gone) */ redirectTo?: string };
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
/** The quick picks on every reminder setter: a month, a week and a day before. */
const FAST_PRESETS = [30, 7, 1];
/** Text fields that are titles: they're capitalised as you type, for consistency. */
const TITLE_FIELDS = new Set(["name", "label", "title", "newSection"]);
const isTitle = (f: FieldDef) => (f.titleCase ?? TITLE_FIELDS.has(f.name)) && (!f.type || f.type === "text");
/** "Remind me this many days before…" → "Remind me". */
const reminderLabel = (l: string) => l.replace(/ \(0 = on the day\)/, "").replace(/ (this many days )?before.*$/i, "");

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
  const [remSummary, setRemSummary] = useState("");

  // Reminders make Active/Archived redundant: keep whatever is stored, but don't ask.
  const archiveField = toggle ? fields.find(isArchiveStatus) : undefined;
  const notesFields = toggle ? fields.filter((f) => f.name === "notes" && !remFields.includes(f)) : [];
  const detailFields = fields.filter((f) => f !== toggle && !remFields.includes(f) && !notesFields.includes(f) && f !== archiveField);
  const tabs = toggle
    ? ([["details", "Details", detailFields], ["reminders", "Reminders", [toggle, ...remFields]], ["notes", "Notes", notesFields]] as const).filter(([, , fs]) => fs.length > 0)
    : [];
  const [tab, setTab] = useState<string>(tabs[0]?.[0] ?? "details");
  // New entries start with reminders off; existing ones show what's saved.
  const isNew = !("id" in fixed) && detailFields.length > 0;
  const [remOn, setRemOn] = useState(() => !!toggle && !isNew && Boolean(initial[toggle.name]));
  const hasTabs = tabs.length > 1;
  // Turning reminders on moves you to the Reminders tab; turning them off sends you back to Details.
  const flipReminders = (on: boolean) => { setRemOn(on); if (hasTabs) setTab(on ? "reminders" : "details"); };
  const reminderSwitch = (where: string) => toggle && (
    <div className="flex items-center justify-between gap-3 sm:col-span-2" key={`__switch-${where}`}>
      <label htmlFor={`${id}-${toggle.name}-${where}`} className="grid gap-0.5 cursor-pointer">
        <span className="font-semibold">Reminders</span>
        <span className="t-meta">{remOn ? remSummary || "On" : "Off"}</span>
      </label>
      <input type="checkbox" role="switch" className="switch" id={`${id}-${toggle.name}-${where}`} checked={remOn} onChange={(e) => flipReminders(e.target.checked)} />
    </div>
  );

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
    if (confirmText && !(await askConfirmFor(confirmText))) return;
    setBusy(true); setError(null);
    const form = e.currentTarget;
    // Required fields must be filled in before anything is sent.
    const data = new FormData(form);
    const missing = fields.filter(visible).find((f) => f.required && !["checkbox", "checks", "intlist", "time", "interval"].includes(f.type ?? "text")
      && !String(data.get(f.name) ?? "").trim());
    if (missing) {
      setBusy(false);
      setError({ message: missing.requiredMessage ?? `Fill in “${missing.label.replace(/\?$/, "")}” first.`, field: missing.name });
      const home = tabs.find(([, , fs]) => (fs as readonly FieldDef[]).includes(missing));
      if (home) setTab(home[0]);
      requestAnimationFrame(() => (form.querySelector(`#${CSS.escape(`${id}-${missing.name}`)}`) as HTMLElement | null)?.focus());
      return;
    }
    const input = { ...toInput(fields.filter(visible), new FormData(form)), ...fixed };
    try {
      const body = nestKey ? { ...nestExtra, [nestKey]: { ...nestBase, ...input } } : input;
      const res = await api<{ id?: string | null; message?: string }>(endpoint ?? `/api/ops/${op}`, body);
      toast(successMessage ?? res.message ?? "Saved");
      if (resetOnSuccess) form.reset();
      onDone?.(res);
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
      if (deleteAction.redirectTo) router.push(deleteAction.redirectTo); else router.refresh();
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
      {toggle && remOn && <input type="hidden" name={toggle.name} value="on" />}
      {tabs.length > 1 && (
        <div className="seg-tabs" role="tablist" aria-label="Sections">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel-${key}`}
              disabled={key === "reminders" && !remOn} title={key === "reminders" && !remOn ? "Turn reminders on in Details" : undefined}
              onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      )}
      {tabs.length ? tabs.map(([key, , fs]) => (
        <div key={key} role={tabs.length > 1 ? "tabpanel" : undefined} id={`${id}-panel-${key}`} aria-labelledby={tabs.length > 1 ? `${id}-tab-${key}` : undefined} hidden={tabs.length > 1 && tab !== key}>
          {key === "reminders" ? reminderBox() : (
            <div className={fs.length > 1 || (key === "details" && hasTabs) ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
              {renderRows((fs as readonly FieldDef[]).filter(visible))}
              {key === "details" && hasTabs && <div className="sm:col-span-2 rule-t pt-4">{reminderSwitch("details")}</div>}
            </div>
          )}
        </div>
      )) : (
        <div className={fields.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
          {renderRows(fields.filter(visible))}
        </div>
      )}
      {error && !(error.field && fields.some((f) => f.name === error.field && visible(f))) && <p role="alert" className="error">{error.message}</p>}
      {!rich ? (
        <div><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
      ) : confirmDel && deleteAction ? (
        <div role="alertdialog" aria-labelledby={`${id}-delq`} className="confirm-box preview-enter">
          <p id={`${id}-delq`} className="font-semibold">{deleteAction.confirm}</p>
          <p className="t-small text-ink-2">{deleteAction.note ?? "You can’t undo this."}</p>
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={() => setConfirmDel(false)} autoFocus>Keep it</button>
            <button type="button" className="btn flex-1 btn-delete" disabled={deleting} onClick={doDelete}>{deleting ? "Deleting…" : "Yes, delete"}</button>
          </div>
        </div>
      ) : (
        <div className="form-foot">
          {deleteAction?.asButton && (
            <button type="button" className="btn flex-1 btn-danger" style={{ minHeight: 48 }} disabled={deleting}
              onClick={async () => { if (await askConfirm(deleteAction.confirm, { note: deleteAction.note ?? "You can’t undo this.", danger: true })) void doDelete(); }}>
              <Icon name="trash" size={16} />{deleteAction.label ?? "Delete"}
            </button>
          )}
          {deleteAction && !deleteAction.asButton && (
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
      <div key="__reminders" className="flex flex-col gap-4">
        {reminderSwitch("reminders")}
        <div className={remOn ? "flex flex-col gap-4 preview-enter" : "hidden"}>
          {others.map((f) => renderField(f, true))}
        </div>
      </div>
    );
  }

  /** Fields that share a `row` go side by side in one full-width line; the rest render as usual. */
  function renderRows(fs: readonly FieldDef[]) {
    const out: React.ReactNode[] = [];
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f.row) { out.push(renderField(f)); continue; }
      const group = [f];
      while (fs[i + 1]?.row === f.row) group.push(fs[++i]);
      out.push(<div key={`row-${f.row}`} className="field-row sm:col-span-2">{group.map((g) => renderField(g))}</div>);
    }
    return out;
  }

  function renderField(f: FieldDef, inReminders = false) {
          {
          const fid = `${id}-${f.name}`;
          const invalid = error?.field === f.name;
          const common = { id: fid, name: f.name, required: f.required, "aria-invalid": invalid || undefined, "aria-describedby": f.help ? `${fid}-h` : undefined };
          if (f === archiveField) return null;
          if (f.type === "intlist" && f.negative) return (
            <div key={f.name} className="field sm:col-span-2" role="group" aria-labelledby={`${fid}-l`}>
              <span id={`${fid}-l`} className="label">{reminderLabel(f.label)}</span>
              <CountdownRail name={f.name} initial={initial[f.name]} anchor={fixedAnchor ?? anchor} endLabel={anchorField ? anchorLabel : "The day"}
                presets={FAST_PRESETS} includeZero={f.includeZero}
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
          if (f.type === "glyph") return (
            <div key={f.name} className="field min-w-0" role="group" aria-labelledby={`${fid}-l`}>
              <span id={`${fid}-l`} className="label">{f.label}</span>
              <GlyphSelect id={fid} name={f.name} options={f.options ?? []} initial={val(f)} labelledBy={`${fid}-l`} />
              {invalid && <span role="alert" className="error t-small">{error?.message}</span>}
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
                <Dropdown name={f.unitName ?? `${f.name}Unit`} ariaLabel={`${f.label} (unit)`} options={f.options ?? []}
                  initial={f.unitName && initial[f.unitName] != null ? String(initial[f.unitName]) : f.options?.[0]?.value} />
              </div>
            </fieldset>
          );
          const Wrap = (f.type === "select" ? "div" : "label") as "label";
          return (
            <Wrap key={f.name} {...(f.type === "select" ? { role: "group" } : { htmlFor: fid })} className={`field ${f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}`}>
              <span className="label">{f.label}{f.required ? "" : <span className="t-meta"> (optional)</span>}</span>
              {f.type === "select" ? (
                <Dropdown id={fid} name={f.name} initial={val(f)} ariaLabel={f.label}
                  options={[...(f.required ? [] : [{ value: "", label: "—" }]), ...(f.options ?? [])]}
                  onChange={(v) => { if (f.name in watch) setWatch((w) => ({ ...w, [f.name]: v })); if (error?.field === f.name) setError(null); }} />
              ) : f.type === "textarea" ? (
                <textarea className="textarea" {...common} defaultValue={val(f)} placeholder={f.placeholder} />
              ) : (
                <input className="input" {...common} defaultValue={val(f)} placeholder={f.placeholder}
                  type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                  inputMode={f.type === "amount" ? "decimal" : f.type === "int" ? "numeric" : undefined}
                  list={f.suggestions?.length ? `${fid}-l` : undefined} autoComplete={f.suggestions?.length ? "off" : undefined}
                  autoCapitalize={isTitle(f) ? "words" : undefined} onInput={(e) => { if (isTitle(f)) titleCaseInput(e); if (invalid) setError(null); }} />
              )}
              {invalid && <span role="alert" className="error t-small">{error?.message}</span>}
              {!!f.suggestions?.length && <datalist id={`${fid}-l`}>{f.suggestions.map((x) => <option key={x} value={x} />)}</datalist>}
              {f.help && <span id={`${fid}-h`} className="t-meta">{f.help}</span>}
            </Wrap>
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
      if (confirmText && !(await askConfirmFor(confirmText))) return;
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

/** The small round X in the top-right corner of every add / edit panel. */
export function PanelClose({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="panel-x" aria-label={label} title="Close" onClick={onClick}>
      <Icon name="close" size={16} strokeWidth={2.2} />
    </button>
  );
}

/**
 * Disclosure wrapper for “add” forms so tracker pages stay calm. While open, the panel has its own X in the
 * top-right corner (the button that opened it steps aside).
 */
export function Reveal({ label, children, open: initialOpen = false, buttonClass = "btn", iconOnly = false, icon, title }: { label: string; children: React.ReactNode; open?: boolean; buttonClass?: string; iconOnly?: boolean; icon?: IconName; title?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  const isAdd = ADD_LABEL.test(label);
  const text = label.replace(/^\+\s*/, "");
  const panel = open && (
    <div id={id} className={`mt-2 panel form-panel panel-closable p-4 preview-enter ${iconOnly ? "basis-full w-full min-w-0 order-last" : ""}`}>
      <PanelClose onClick={() => setOpen(false)} label={`Close ${text.toLowerCase()}`} />
      <p className="t-h3 mb-3 pr-10">{title ?? text}</p>
      <RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider>
    </div>
  );
  if (iconOnly) return (
    <div className="contents">
      <button type="button" className="plus-btn" aria-label={open ? "Close" : text} title={text} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <PlusIcon size={22} />
      </button>
      {panel}
    </div>
  );
  return (
    <div className={open ? "basis-full w-full min-w-0" : undefined}>
      {open ? null : icon ? (
        <button type="button" className={buttonClass} aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)}><Icon name={icon} size={15} />{label}</button>
      ) : isAdd ? (
        <button type="button" className={`btn add-btn ${buttonClass.includes("btn-sm") ? "btn-sm" : ""}`} aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)}>
          <span className="add-ico"><PlusIcon size={buttonClass.includes("btn-sm") ? 15 : 18} /></span>{text}
        </button>
      ) : (
        <button type="button" className={buttonClass} aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)}>{label}</button>
      )}
      {panel}
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
      {label === "Edit" ? (
        <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={open ? "Close editing" : "Edit"} title={open ? "Close" : "Edit"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <Icon name={open ? "close" : "edit"} size={17} />
        </button>
      ) : (
        <button type="button" className={buttonClass} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close" : label}</button>
      )}
      {open && <div id={id} className="mt-3 panel form-panel p-4 grid gap-3 preview-enter"><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{children}</RevealCtx.Provider></div>}
    </div>
  );
}

/** A bin icon that asks (with the site's popup) and then deletes. Sits beside the edit pencil on a card's title line. */
export function DeleteIcon({ op, input, confirm, note, label = "Delete", redirectTo, className = "icon-ghost icon-danger" }: {
  op: string; input: unknown; confirm: string; note?: string; label?: string; redirectTo?: string; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} style={{ margin: 0 }} aria-label={label} title={label} disabled={busy}
      onClick={async () => {
        if (!(await askConfirm(confirm, { note: note ?? "You can’t undo this.", danger: true }))) return;
        setBusy(true);
        try {
          const r = await api<{ message?: string }>(`/api/ops/${op}`, input);
          toast(r.message ?? "Deleted");
          if (redirectTo) router.push(redirectTo); else router.refresh();
        } catch (e) { toast(e instanceof Error ? e.message : "Couldn't delete. Nothing was changed.", "error"); setBusy(false); }
      }}>
      <Icon name="trash" size={17} />
    </button>
  );
}

type DelAction = { op: string; input: unknown; confirm: string; note?: string; label?: string; redirectTo?: string };
/**
 * A list item whose name line carries the pencil (edit) and bin (delete) icons at its right end.
 * The edit form opens under the item in a panel with its own X.
 */
export function ItemRow({ head, aside, children, edit, editHref, del, name = "this" }: { head: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode; edit?: React.ReactNode; editHref?: string; del?: DelAction; name?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className="item-head">
        <div className="min-w-0 flex-1">{head}</div>
        {aside && <div className="shrink-0">{aside}</div>}
        <div className="entry-actions">
          {editHref
            ? <Link href={editHref} className="icon-ghost" style={{ margin: 0 }} aria-label={`Edit ${name}`} title="Edit"><Icon name="edit" size={17} /></Link>
            : <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={open ? "Close editing" : `Edit ${name}`} title="Edit" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
                <Icon name="edit" size={17} />
              </button>}
          {del && <DeleteIcon op={del.op} input={del.input} confirm={del.confirm} note={del.note} label={`Delete ${name}`} redirectTo={del.redirectTo} />}
        </div>
      </div>
      {children}
      {open && !editHref && (
        <div id={id} className="panel form-panel panel-closable p-4 mt-1 preview-enter">
          <PanelClose onClick={() => setOpen(false)} label="Close editing" />
          <p className="t-h3 mb-3 pr-10">Edit</p>
          <RevealCtx.Provider value={{ close: () => setOpen(false) }}>{edit}</RevealCtx.Provider>
        </div>
      )}
    </>
  );
}
