import Link from "next/link";
import { pageOwner, applicationsState } from "@/server/queries";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, Reveal } from "@/components/OpForm";
import { applicationFields, STATUS_LABEL } from "../fields";
import { fmtDateTime } from "@/lib/format";

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
    const tone = r.overdue ? "var(--rust)" : r.window !== null && r.window <= 7 ? "var(--rust)" : r.window !== null ? "var(--mustard)" : null;
    return (
      <Link href={`/education/applications/${a.id}`} className="panel p-4 grid gap-1 no-underline hover:bg-[color-mix(in_srgb,var(--surface)_85%,var(--mustard))]" style={tone ? { boxShadow: `inset 6px 0 0 ${tone}` } : undefined}>
        <span className="flex flex-wrap justify-between gap-2">
          <span className="t-h3">{a.university}</span>
          <span className="chip chip-fill">{STATUS_LABEL[a.status]}</span>
        </span>
        <span className="t-small text-ink-2">{a.program}{a.intake ? `, ${a.intake}` : ""}{a.country ? `, ${a.country}` : ""}</span>
        <span className="t-small">
          {a.deadlineAt ? <>Deadline {fmtDateTime(a.deadlineAt, o.timezone)} your time{r.open && r.daysLeft !== null ? <strong>{r.overdue ? " (passed)" : r.daysLeft === 0 ? " (today)" : ` (${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left)`}</strong> : null}</> : <span className="text-ink-3">No deadline set</span>}
          {a.deadlineAt && !a.deadlineVerified && <span className="chip chip-mustard ml-2">not verified</span>}
        </span>
        {r.reqTotal > 0 && <span className="t-meta">Requirements {r.reqDone}/{r.reqTotal}</span>}
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
        : view === "list" ? <ul className="grid gap-3">{rows.map((r) => <li key={r.app.id}><Card r={r} /></li>)}</ul>
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
