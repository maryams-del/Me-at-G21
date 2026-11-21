import { notFound } from "next/navigation";
import Link from "next/link";
import { pageOwner, applicationDetail } from "@/server/queries";
import { PageHeader, Section, ReminderList } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { PageAddProvider, PageEditButton, PageAddPanel } from "@/components/PageAdd";
import { applicationFields, STATUS_LABEL, STATUS_OPTIONS } from "../../fields";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { formatInstant, todayLocal } from "@/lib/time";

export default async function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await pageOwner();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await applicationDetail(o, id);
  if (!d) notFound();
  const a = d.app;
  const today = todayLocal(o.timezone);
  const theirTime = a.deadlineAt && a.deadlineTz && a.deadlineTz !== o.timezone
    ? formatInstant(a.deadlineAt, a.deadlineTz, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null;

  return (
    <>
      <PageAddProvider>
      <PageHeader glyph="applications" title={a.university} intro={`${a.program}${a.intake ? `, ${a.intake}` : ""}${a.country ? `, ${a.country}` : ""}`}>
        <span className="chip chip-fill self-center">{STATUS_LABEL[a.status]}</span>
        <PageEditButton label="Edit details" />
      </PageHeader>
      <PageAddPanel id="edit" title="Edit details">
        <OpForm op="application.update" fields={applicationFields([], true)} fixed={{ id: a.id, links: a.links, documentIds: a.documentIds }}
          initial={{ ...a, fee: a.feeMinor !== null ? fromMinor(a.feeMinor, a.feeCurrency ?? "SAR") : "", linksText: a.links.map((l) => `${l.label} | ${l.url}`).join("\n") }} submitLabel="Save"
          deleteAction={{ op: "application.delete", input: { id: a.id }, confirm: `Delete ${a.program} at ${a.university}?`, asButton: true, label: "Delete application", redirectTo: "/education/applications" }} />
      </PageAddPanel>
      </PageAddProvider>

      <div className="money-tiles mb-8">
        <div className="tile slate min-h-0">
          <p className="t-small">Deadline</p>
          {a.deadlineAt ? (
            <>
              <p className="t-num text-[1.9rem] mt-2">{fmtDateTime(a.deadlineAt, o.timezone)}</p>
              <p className="t-small mt-1">Your time ({o.timezone}){theirTime ? `. University time: ${theirTime} (${a.deadlineTz})` : ""}</p>
              <p className="t-small mt-1">{a.deadlineVerified ? "Verified on the official site." : "Not verified yet. Check the official program page."}</p>
            </>
          ) : <p className="t-small mt-2">No deadline set. Add it from the official site with the pencil above.</p>}
        </div>
        <div className="tile min-h-0">
          <p className="t-small text-ink-2">Fee and funding</p>
          <p className="t-h3 mt-2">{a.feeMinor !== null ? formatMoney(a.feeMinor, a.feeCurrency ?? "SAR") : "No fee recorded"}</p>
          {a.funding && <p className="t-small text-ink-2 mt-1">{a.funding}</p>}
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        <Reveal label="Update status" buttonClass="btn btn-primary">
          <OpForm op="application.status" fixed={{ id: a.id }} initial={{ status: a.status === "researching" ? "preparing" : a.status === "preparing" ? "submitted" : a.status, onDate: today }} submitLabel="Save status" fields={[
            { name: "status", label: "New status", type: "select", required: true, options: STATUS_OPTIONS }, { name: "onDate", label: "Date", type: "date", required: true }, { name: "note", label: "Note", nullable: true, wide: true }]} />
        </Reveal>
        {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn">Open application site</a>}
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title={`Requirements${d.reqs.length ? ` (${d.reqs.filter((r) => r.doneAt).length}/${d.reqs.length})` : ""}`}>
          {d.reqs.length ? (
            <ul className="grid gap-1.5 mb-3">
              {d.reqs.map((r) => (
                <li key={r.id} className="flex items-start gap-3">
                  <OpButton op="requirement.toggle" input={{ id: r.id, done: !r.doneAt }} label={r.doneAt ? "✓" : " "} ariaLabel={`${r.doneAt ? "Mark not done" : "Mark done"}: ${r.title}`} className="btn btn-sm w-9 px-0 shrink-0" />
                  <span className="t-small pt-2 flex-1" style={{ textDecoration: r.doneAt ? "line-through" : undefined }}>{r.title}</span>
                  <OpButton op="requirement.delete" input={{ id: r.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText={`Remove “${r.title}”?`} />
                </li>
              ))}
            </ul>
          ) : <p className="t-meta mb-3">No requirements listed.</p>}
          <OpForm op="requirement.add" fixed={{ applicationId: a.id }} submitLabel="Add requirement" compact fields={[{ name: "title", label: "Requirement", required: true, placeholder: "IELTS 7.0" }]} />
        </Section>

        <Section title="Follow-up tasks">
          {d.followUps.length ? (
            <ul className="list mb-3">{d.followUps.map((t) => (
              <li key={t.id} className="py-2 flex items-start gap-3">
                <OpButton op="task.complete" input={{ id: t.id, done: t.status !== "done" }} label={t.status === "done" ? "✓" : " "} ariaLabel={`${t.status === "done" ? "Reopen" : "Complete"}: ${t.title}`} className="btn btn-sm w-9 px-0 shrink-0" />
                <span className="t-small pt-2" style={{ textDecoration: t.status === "done" ? "line-through" : undefined }}>{t.title}{t.dueOn && <span className="t-meta"> due {fmtDate(t.dueOn)}</span>}</span>
              </li>))}</ul>
          ) : <p className="t-meta mb-3">No follow-ups yet.</p>}
          <OpForm op="task.create" fixed={{ applicationId: a.id, status: "backlog", remindersEnabled: true }} submitLabel="Add follow-up" compact fields={[
            { name: "title", label: "Follow-up", required: true, placeholder: "Email the professor about funding" }, { name: "dueOn", label: "Due", type: "date", nullable: true }]} />
        </Section>

        <Section title="Documents & links">
          <ul className="list mb-3">
            {d.docs.map((doc) => (
              <li key={doc.id} className="py-2 flex justify-between items-center gap-2 t-small">
                <Link href={`/admin/documents?q=${encodeURIComponent(doc.title)}`} className="underline underline-offset-4">{doc.title}</Link>
                <OpButton op="application.document" input={{ id: a.id, documentId: doc.id, linked: false }} label="Unlink" className="btn btn-sm btn-ghost" />
              </li>
            ))}
            {a.links.map((l) => <li key={l.url} className="py-2 t-small"><a href={l.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{l.label}</a></li>)}
          </ul>
          {d.allDocs.filter((x) => !a.documentIds.includes(x.id)).length > 0 && (
            <OpForm op="application.document" fixed={{ id: a.id, linked: true }} submitLabel="Link document" compact fields={[
              { name: "documentId", label: "Link a document from your vault", type: "select", required: true, options: d.allDocs.filter((x) => !a.documentIds.includes(x.id)).map((x) => ({ value: x.id, label: x.title })) }]} />
          )}
        </Section>

        <Section title="Status history">
          <ul className="list">{d.events.map((e) => (
            <li key={e.id} className="py-2 t-small flex justify-between gap-3"><span>{e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}{STATUS_LABEL[e.toStatus]}{e.note ? `: ${e.note}` : ""}</span><span className="t-meta">{fmtDate(e.onDate)}</span></li>
          ))}</ul>
          {a.submittedOn && <p className="t-small mt-2">Submitted on {fmtDate(a.submittedOn)}</p>}
        </Section>

        {(a.contacts || a.notes) && (
          <Section title="Contacts & notes">
            {a.contacts && <p className="t-small whitespace-pre-line mb-2">{a.contacts}</p>}
            {a.notes && <p className="t-small whitespace-pre-line text-ink-2">{a.notes}</p>}
          </Section>
        )}
        <div className="md:col-span-2"><Section title="Upcoming reminders"><ReminderList items={d.reminders} tz={o.timezone} /></Section></div>
      </div>
    </>
  );
}
