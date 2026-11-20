import Link from "next/link";
import { pageOwner, applicationsState } from "@/server/queries";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, Reveal } from "@/components/OpForm";
import { applicationFields, STATUS_LABEL } from "../fields";
import { fmtDateTime } from "@/lib/format";
import { countdown } from "@/lib/countdown";
import { Icon } from "@/components/icons";

const BOARD = [
  { label: "Researching", statuses: ["researching"] }, { label: "Preparing", statuses: ["preparing"] },
  { label: "Submitted", statuses: ["submitted", "interview", "decision"] }, { label: "Outcome", statuses: ["accepted", "rejected", "withdrawn"] },
];

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ view?: string; add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const rows = await applicationsState(o);
  const docs = await getDb().select({ id: documents.id, title: documents.title }).from(documents).where(and(eq(documents.ownerId, o.id), isNull(documents.deletedAt))).orderBy(asc(documents.title));
  const view = sp.view === "board" ? "board" : "list";

  const Card = ({ r }: { r: (typeof rows)[number] }) => {
    const a = r.app;
    const cd = a.deadlineAt && r.open ? countdown(r.daysLeft, "deadline") : null;
    return (
      <Link href={`/education/applications/${a.id}`} className="entry no-underline" style={{ textDecoration: "none" }}>
        <span className="entry-head">
          <span className="min-w-0 flex-1 grid gap-0.5">
            <span className="entry-title">{a.university}</span>
            <span className="entry-sub">{a.program}{a.intake ? ` · ${a.intake}` : ""}{a.country ? ` · ${a.country}` : ""}</span>
          </span>
          <span className="chip chip-fill shrink-0">{STATUS_LABEL[a.status]}</span>
        </span>
        <span className="entry-row">
          {cd ? (
            <span className={`entry-count ${cd.tone}`}><span className="n">{cd.n}</span><span className="grid"><span className="u">{cd.unit}</span><span className="s">{fmtDateTime(a.deadlineAt as Date, o.timezone)} your time</span></span></span>
          ) : <span className="t-small text-ink-3">{a.deadlineAt ? `Deadline ${fmtDateTime(a.deadlineAt, o.timezone)}` : "No deadline set"}</span>}
          {a.deadlineAt && !a.deadlineVerified && <span className="chip chip-mustard">not verified</span>}
        </span>
        {r.reqTotal > 0 && <span className="entry-foot"><Icon name="check" size={13} />Requirements {r.reqDone}/{r.reqTotal}</span>}
      </Link>
    );
  };

  return (
    <>
      <PageHeader glyph="applications" title="Master's applications">
        <a href="?view=list" className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`} aria-current={view === "list" ? "page" : undefined}>By deadline</a>
        <a href="?view=board" className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} aria-current={view === "board" ? "page" : undefined}>Board</a>
      </PageHeader>
      <div className="mb-8">
        <Reveal label="Add application" buttonClass="btn btn-primary" open={sp.add === "1"}>
          <OpForm op="application.create" fields={applicationFields(docs)} initial={{ deadlineTz: o.timezone, reminderOffsetsDays: [-30, -14, -7, -1], remindersEnabled: true, feeCurrency: "SAR" }} submitLabel="Add application" />
        </Reveal>
      </div>
      {rows.length === 0 ? <Empty>No applications yet. Add each program you&apos;re considering; you can track several programs at the same university.</Empty>
        : view === "list" ? <ul className="entry-grid">{rows.map((r) => <li key={r.app.id}><Card r={r} /></li>)}</ul>
        : (
          <div className="grid gap-4 md:grid-cols-4">
            {BOARD.map((col) => {
              const items = rows.filter((r) => col.statuses.includes(r.app.status));
              return (
                <section key={col.label} className="grid gap-2 content-start" aria-label={col.label}>
                  <h2 className="t-h3 pb-2 rule-b">{col.label} <span className="t-meta">{items.length}</span></h2>
                  {items.map((r) => <Card key={r.app.id} r={r} />)}
                </section>
              );
            })}
          </div>
        )}
    </>
  );
}
