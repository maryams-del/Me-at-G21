import { notFound } from "next/navigation";
import { pageOwner, documentDetail } from "@/server/queries";
import { fmtDateTime } from "@/lib/format";
import { DocEditor } from "./DocEditor";

/** A document's own edit page: file preview and versions on the left, its details, reminders, files and notes on the right. */
export default async function DocumentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await pageOwner();
  const d = await documentDetail(o, id);
  if (!d) notFound();
  const { doc } = d;
  return (
    <DocEditor
      doc={{ id: doc.id, title: doc.title, kind: doc.kind, issuer: doc.issuer, issuedOn: doc.issuedOn, expiresOn: doc.expiresOn, notes: doc.notes, idMasked: doc.idMasked, personId: doc.personId, tags: doc.tags }}
      files={d.files.map((f) => ({ id: f.id, version: f.version, filename: f.filename, contentType: f.contentType, sizeBytes: f.sizeBytes, when: fmtDateTime(f.createdAt, o.timezone) }))}
      reminders={d.reminders ? { enabled: d.reminders.remindersEnabled, offsets: d.reminders.reminderOffsetsDays, time: d.reminders.reminderTime } : null}
    />
  );
}
