import { pageOwner, documentsState, documentStorageBytes, peopleList } from "@/server/queries";
import { PeopleManager } from "../People";
import { FilterPanel } from "@/components/FilterPanel";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, EditPanel, type FieldDef } from "@/components/OpForm";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { UploadButton, ProtectedId, ShareFile, NewDocumentForm } from "./DocClient";

const KINDS = [
  { value: "passport", label: "Passport" }, { value: "national_id", label: "National ID / Iqama" }, { value: "transcript", label: "Transcript" },
  { value: "certificate", label: "Certificate" }, { value: "cv", label: "CV" }, { value: "application", label: "Application file" },
  { value: "letter", label: "Official letter" }, { value: "other", label: "Other" },
];
const baseFields: FieldDef[] = [
  { name: "title", label: "Title", required: true, placeholder: "Passport" },
  { name: "kind", label: "Type", type: "select", required: true, options: KINDS },
  { name: "issuer", label: "Issued by", nullable: true },
  { name: "issuedOn", label: "Issue date", type: "date", nullable: true },
  { name: "expiresOn", label: "Expiry date", type: "date", nullable: true },
  { name: "notes", label: "Notes", type: "textarea", nullable: true },
];
const kb = (n: number) => (n === 0 ? "0 MB" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ add?: string; kind?: string; q?: string; sort?: string; reminders?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const kind = KINDS.some((k) => k.value === sp.kind) ? sp.kind : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const people = await peopleList(o.id);
  const reminders = sp.reminders === "on" || sp.reminders === "off" ? sp.reminders : undefined;
  const rows = await documentsState(o, { kind, q, sort: sp.sort, reminders });
  const filtered = !!(kind || q || reminders);
  const used = await documentStorageBytes(o.id);
  const LIMIT = 1024 * 1024 * 1024; // Vercel Blob free (Hobby) allowance
  const pct = Math.min(100, (used / LIMIT) * 100);
  return (
    <>
      <PageHeader glyph="documents" title="Documents & IDs" />
      <div className="mb-8 flex flex-wrap gap-3 items-start">
        <Reveal label="Add a document" buttonClass="btn btn-primary" open={sp.add === "1"}>
          <NewDocumentForm />
        </Reveal>
        <PeopleManager people={people} />
        <FilterPanel active={!!(filtered || sp.sort)}>
          <form className="panel p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto_auto] items-end" role="search" aria-label="Filter documents">
          <label className="field"><span className="label">Search</span><input name="q" defaultValue={q} className="input" placeholder="e.g. maryam passport" /></label>
          <label className="field"><span className="label">Reminders</span>
            <select name="reminders" defaultValue={reminders ?? ""} className="select"><option value="">All</option><option value="on">On</option><option value="off">Off</option></select></label>
          <label className="field"><span className="label">Type</span>
            <select name="kind" defaultValue={kind ?? ""} className="select"><option value="">All types</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
          <label className="field"><span className="label">Sort</span>
            <select name="sort" defaultValue={sp.sort ?? ""} className="select"><option value="">By type</option><option value="expiry">Expiring soonest</option><option value="recent">Recently updated</option></select></label>
          <button className="btn">Apply</button>
          {(filtered || sp.sort) && <a href="/admin/documents" className="btn btn-ghost">Clear</a>}
        </form>
        </FilterPanel>
      </div>
      <div className="mb-6 grid gap-1 max-w-md" aria-label="File storage used">
        <div className="flex justify-between t-small"><span>File storage</span><span>{kb(used)} of 1 GB free</span></div>
        <div className="bar" role="img" aria-label={`${pct.toFixed(1)}% used`}><i style={{ width: `${Math.max(pct, used ? 0.5 : 0)}%`, background: pct > 80 ? "var(--rust)" : "var(--ink)" }} /></div>
        {pct > 80 && <p className="t-small" style={{ color: "var(--danger)" }}>Nearly full. Delete old file versions you don&apos;t need; going over the free limit pauses file access for up to 30 days.</p>}
      </div>
      {rows.length === 0 ? (filtered ? <Empty>No documents match{kind ? ` type “${KINDS.find((k) => k.value === kind)?.label}”` : ""}{q ? ` “${q}”` : ""}.</Empty> : <Empty>No documents yet. Add your passport, national ID, transcripts, certificates or CV versions.</Empty>) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ doc: d, files, reminders: rem }) => {
            const latest = files[0];
            return (
            <li key={d.id} className="panel p-4 grid gap-2 content-start">
              <div className="flex justify-between items-baseline gap-3">
                <h2 className="t-h3 min-w-0 truncate">{d.title}</h2>
                <p className="t-small text-ink-2 shrink-0">{d.expiresOn ? `Expires ${fmtDate(d.expiresOn)}` : d.issuedOn ? `Issued ${fmtDate(d.issuedOn)}` : ""}</p>
              </div>
              {latest
                ? <a className="t-small inline-flex items-center gap-1.5 underline underline-offset-4 min-w-0" href={`/api/documents/file/${latest.id}?view=1`} target="_blank" rel="noopener">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
                    <span className="truncate">{latest.filename}</span></a>
                : <p className="t-meta">No file attached</p>}
              <EditPanel label="Edit details" buttonClass="btn btn-sm">
                <div className="grid gap-4">
                  <div>
                    <h3 className="t-small font-semibold mb-1">Files</h3>
                    {files.length ? (
                      <ul className="list">
                        {files.map((f, i) => (
                          <li key={f.id} className="py-2 grid gap-1">
                            <span className="t-small break-words">{f.filename} <span className="t-meta">v{f.version}{i === 0 ? " (latest)" : ""}, {kb(f.sizeBytes)}, {fmtDateTime(f.createdAt, o.timezone)}</span></span>
                            <span className="flex flex-wrap gap-1">
                              <ShareFile fileId={f.id} filename={f.filename} contentType={f.contentType} />
                              <a className="btn btn-sm btn-ghost" href={`/api/documents/file/${f.id}?view=1`} target="_blank" rel="noopener">View</a>
                              <a className="btn btn-sm btn-ghost" href={`/api/documents/file/${f.id}`}>Download</a>
                              <OpButton op="document.file.delete" input={{ fileId: f.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText={`Delete ${f.filename} v${f.version}? This can't be undone.`} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="t-meta">No file uploaded.</p>}
                    <div className="mt-2"><UploadButton documentId={d.id} hasFiles={files.length > 0} /></div>
                  </div>
                  {d.idMasked && <div className="t-small"><span className="text-ink-3 mr-2">ID number</span><ProtectedId documentId={d.id} masked={d.idMasked} /></div>}
                  {d.expiresOn && (
                    <div>
                      <h3 className="t-small font-semibold mb-2">Expiry reminders</h3>
                      <OpForm op="document.reminders" fixed={{ documentId: d.id }} submitLabel="Save reminders" compact
                        initial={{ remindersEnabled: !!rem?.remindersEnabled, reminderOffsetsDays: rem?.reminderOffsetsDays ?? [-90, -30, -7], reminderTime: rem?.reminderTime ?? "09:00" }}
                        fields={[
                          { name: "reminderOffsetsDays", label: "Remind me this many days before", type: "intlist", negative: true },
                          { name: "reminderTime", label: "Reminder time", type: "time", required: true },
                          { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
                        ]} />
                    </div>
                  )}
                  <div>
                    <h3 className="t-small font-semibold mb-2">Details</h3>
                    <OpForm op="document.update" fixed={{ id: d.id, personId: d.personId }} initial={{ ...d, idNumber: "" }} submitLabel="Save details" compact fields={[
                      ...baseFields.slice(0, 5),
                      { name: "idNumber", label: d.idMasked ? "Replace ID number" : "ID number", help: d.idMasked ? "Leave empty to keep the current number." : undefined },
                      ...(d.idMasked ? [{ name: "clearId", label: "Remove the stored ID number", type: "checkbox", wide: true } as FieldDef] : []),
                      baseFields[5],
                    ]} />
                  </div>
                  <OpButton op="document.delete" input={{ id: d.id }} label="Delete document" className="btn btn-sm btn-ghost justify-self-start" confirmText={`Delete “${d.title}”, its ID number and all its files? This can't be undone.`} />
                </div>
              </EditPanel>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
