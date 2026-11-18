import { pageOwner, documentsState } from "@/server/queries";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { UploadButton, ProtectedId, ShareFile } from "./DocClient";

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
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const rows = await documentsState(o);
  return (
    <>
      <PageHeader glyph="documents" title="Documents & IDs" intro="Files are encrypted before they're stored and only open after you sign in. ID numbers are stored separately and need Face ID / Touch ID to reveal. Nothing here is ever sent to the AI assistant." />
      <div className="mb-8">
        <Reveal label="Add a document" buttonClass="btn btn-primary" open={sp.add === "1"}>
          <OpForm op="document.create" submitLabel="Save document" initial={{ kind: "passport", trackExpiry: true }} fields={[
            ...baseFields.slice(0, 5),
            { name: "idNumber", label: "ID number", help: "Encrypted; shown only as the last 4 digits until you reveal it." },
            { name: "trackExpiry", label: "Remind me before it expires (adds it to Expiries)", type: "checkbox", wide: true },
            baseFields[5],
          ]} />
          <p className="t-meta mt-3">After saving, upload the file (PDF or photo, up to 4 MB) from the document card.</p>
        </Reveal>
      </div>
      {rows.length === 0 ? <Empty>No documents yet. Add your passport, national ID, transcripts, certificates or CV versions.</Empty> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ doc: d, files, tracked }) => (
            <li key={d.id} className="panel p-4 grid gap-3 content-start">
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="t-h3">{d.title}</h2>
                  <p className="t-meta">{[KINDS.find((k) => k.value === d.kind)?.label, d.issuer].filter((x) => x && x !== d.title).join(", ")}</p>
                </div>
                {d.expiresOn && <p className="t-small text-right">Expires<br /><span className="font-medium">{fmtDate(d.expiresOn)}</span>{tracked && <span className="block t-meta">reminders on</span>}</p>}
              </div>
              {d.idMasked && <div className="t-small"><span className="text-ink-3 mr-2">ID number</span><ProtectedId documentId={d.id} masked={d.idMasked} /></div>}
              {d.issuedOn && <p className="t-small text-ink-2">Issued {fmtDate(d.issuedOn)}</p>}
              {d.notes && <p className="t-small text-ink-2">{d.notes}</p>}
              <div>
                <h3 className="t-small font-semibold mb-1">Files</h3>
                {files.length ? (
                  <ul className="list">
                    {files.map((f, i) => (
                      <li key={f.id} className="py-2 grid gap-1">
                        <span className="t-small">{f.filename} <span className="t-meta">v{f.version}{i === 0 ? " (latest)" : ""}, {kb(f.sizeBytes)}, {fmtDateTime(f.createdAt, o.timezone)}</span></span>
                        <span className="flex flex-wrap gap-1">
                          <a className="btn btn-sm btn-ghost" href={`/api/documents/file/${f.id}?view=1`} target="_blank" rel="noopener">View</a>
                          <a className="btn btn-sm btn-ghost" href={`/api/documents/file/${f.id}`}>Download</a>
                          <ShareFile fileId={f.id} filename={f.filename} contentType={f.contentType} />
                          <OpButton op="document.file.delete" input={{ fileId: f.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText={`Delete ${f.filename} v${f.version}? This can't be undone.`} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="t-meta">No file uploaded.</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <UploadButton documentId={d.id} hasFiles={files.length > 0} />
                <Reveal label="Edit details" buttonClass="btn btn-sm">
                  <OpForm op="document.update" fixed={{ id: d.id }} initial={{ ...d, idNumber: "" }} submitLabel="Save" fields={[
                    ...baseFields.slice(0, 5),
                    { name: "idNumber", label: d.idMasked ? "Replace ID number" : "ID number", help: d.idMasked ? "Leave empty to keep the current number." : undefined },
                    ...(d.idMasked ? [{ name: "clearId", label: "Remove the stored ID number", type: "checkbox", wide: true } as FieldDef] : []),
                    baseFields[5],
                  ]} />
                </Reveal>
                <OpButton op="document.delete" input={{ id: d.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText={`Delete “${d.title}”, its ID number and all its files? This can't be undone.`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
