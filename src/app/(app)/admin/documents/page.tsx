import { pageOwner, documentsState, documentStorageBytes, peopleList } from "@/server/queries";
import { PeopleManager } from "../People";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { PageHeader, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { OpForm, OpButton, ItemRow, type FieldDef } from "@/components/OpForm";
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
const SORTS = [{ value: "", label: "By type" }, { value: "expiry", label: "Expiring soonest" }, { value: "recent", label: "Recently updated" }];
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
  const params = { q, kind, reminders, sort: sp.sort };
  const used = await documentStorageBytes(o.id);
  const LIMIT = 1024 * 1024 * 1024; // Vercel Blob free (Hobby) allowance
  const pct = Math.min(100, (used / LIMIT) * 100);
  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <PageHeader glyph="documents" title="Documents & IDs"><PageAddButton label="Add a document" /></PageHeader>
      <div className="toolbar">
        <SearchPill q={q} placeholder="Search documents" keep={{ kind, reminders, sort: sp.sort }} />
        <FilterPanel active={!!(kind || reminders || sp.sort)}>
          <form className="panel p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] items-end" role="search" aria-label="Filter documents">
            {q && <input type="hidden" name="q" value={q} />}
            <FilterSelect label="Reminders" name="reminders" value={reminders} options={[{ value: "", label: "All" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            <FilterSelect label="Type" name="kind" value={kind} options={[{ value: "", label: "All types" }, ...KINDS]} />
            <FilterSelect label="Sort" name="sort" value={sp.sort} options={SORTS} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
        <PeopleManager people={people} />
      </div>
      <FilterTags clearHref="/admin/documents" tags={[
        ...(q ? [{ label: `“${q}”`, href: withoutParam("/admin/documents", params, "q") }] : []),
        ...(kind ? [{ label: KINDS.find((k) => k.value === kind)?.label ?? kind, href: withoutParam("/admin/documents", params, "kind") }] : []),
        ...(reminders ? [{ label: `Reminders ${reminders}`, href: withoutParam("/admin/documents", params, "reminders") }] : []),
        ...(sp.sort ? [{ label: SORTS.find((x) => x.value === sp.sort)?.label ?? sp.sort, href: withoutParam("/admin/documents", params, "sort") }] : []),
      ]} />
      <PageAddPanel title="Add a document">
        <NewDocumentForm />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />
      <div className="mb-6 grid gap-1 max-w-md" aria-label="File storage used">
        <div className="flex justify-between t-small"><span>File storage</span><span>{kb(used)} used of 1 GB</span></div>
        <div className="bar" role="img" aria-label={`${pct.toFixed(1)}% used`}><i style={{ width: `${Math.max(pct, used ? 0.5 : 0)}%`, background: pct > 80 ? "var(--rust)" : "var(--ink)" }} /></div>
        {pct > 80 && <p className="t-small" style={{ color: "var(--danger)" }}>Nearly full. Delete old file versions you don&apos;t need; going over the free limit pauses file access for up to 30 days.</p>}
      </div>
      {rows.length === 0 ? (filtered ? <Empty>No documents match{kind ? ` type “${KINDS.find((k) => k.value === kind)?.label}”` : ""}{q ? ` “${q}”` : ""}.</Empty> : <Empty>No documents yet. Add your passport, national ID, transcripts, certificates or CV versions.</Empty>) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ doc: d, files, reminders: rem }) => {
            const latest = files[0];
            return (
            <li key={d.id} className="panel p-4 grid gap-2 content-start">
              <ItemRow del={{ op: "document.delete", input: { id: d.id }, confirm: `Delete “${d.title}”, its ID number and all its files?`, label: "Delete document" }} name={d.title}
                head={<><h2 className="t-h3 min-w-0 truncate">{d.title}</h2><p className="t-meta">{d.expiresOn ? `Expires ${fmtDate(d.expiresOn)}` : d.issuedOn ? `Issued ${fmtDate(d.issuedOn)}` : ""}</p></>}
                edit={
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
                          { name: "reminderOffsetsDays", label: "Remind me", type: "intlist", negative: true, anchorDate: d.expiresOn },
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
                    ]} 
                      deleteAction={{ op: "document.delete", input: { id: d.id }, confirm: `Delete “${d.title}”, its ID number and all its files?`, label: "Delete document" }} />
                  </div>
                </div>}>
              {latest
                ? <a className="t-small inline-flex items-center gap-1.5 underline underline-offset-4 min-w-0" href={`/api/documents/file/${latest.id}?view=1`} target="_blank" rel="noopener">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
                    <span className="truncate">{latest.filename}</span></a>
                : <p className="t-meta">No file attached</p>}
              </ItemRow>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
