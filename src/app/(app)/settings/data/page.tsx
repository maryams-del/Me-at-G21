import { and, desc, eq } from "drizzle-orm";
import { pageOwner } from "@/server/queries";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpButton } from "@/components/OpForm";
import { CSV_MODULES } from "@/server/csv";
import { listTrash, RETENTION_DAYS } from "@/server/ops/trash";
import { KEEP_AUTOMATIC } from "@/server/backup";
import { fmtDateTime } from "@/lib/format";
import { PrivateCsvLink, RestorePanel } from "./DataClient";

const KIND: Record<string, string> = { automatic: "Nightly", manual: "Made by you", "pre-restore": "Safety copy before a restore" };
const size = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export default async function DataPage() {
  const o = await pageOwner();
  const [list, trash] = await Promise.all([
    getDb().select().from(backups).where(and(eq(backups.ownerId, o.id))).orderBy(desc(backups.createdAt)).limit(40),
    listTrash(o.id),
  ]);
  const groups = [...new Set(CSV_MODULES.map((m) => m.group))];
  const items = (b: (typeof list)[number]) => Object.entries(b.counts).filter(([k]) => !["audit_events", "reminders", "notification_deliveries", "notification_preferences"].includes(k)).reduce((a, [, v]) => a + v, 0);

  return (
    <>
      <PageHeader glyph="settings" title="Data & backups" intro="Download your data, keep backups, restore from one, and undo deletes." />

      <Section title="Spreadsheets">
        <p className="t-small text-ink-2 mb-4 prose-w">One file per section, for Excel, Numbers or Google Sheets. Dates are dd/mm/yyyy. Passwords, sign-in details, full ID numbers and uploaded files are never included.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g} className="panel p-4">
              <p className="t-small font-medium mb-2">{g}</p>
              <ul className="grid gap-1.5">
                {CSV_MODULES.filter((m) => m.group === g).map((m) => (
                  <li key={m.key}>{m.private
                    ? <PrivateCsvLink href={`/api/export/csv?module=${m.key}&private=1`} label={`${m.label} (private)`} />
                    : <a className="t-small" href={`/api/export/csv?module=${m.key}`} download>{m.label}</a>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="t-small mt-4"><a href="/api/export" download>Everything as one JSON file</a> <span className="text-ink-2">(for moving to another app)</span></p>
      </Section>

      <Section title="Backups" aside={<a className="btn btn-primary" href="/api/backup/download?id=new" download>Download a backup now</a>}>
        <p className="t-small text-ink-2 mb-4 prose-w">
          A backup is every record you've entered (not your uploaded files, which stay in private storage) in one encrypted file. Only this app can open it, and only for your account.
          The app makes one every night and keeps the last {KEEP_AUTOMATIC}. Downloading one now and then and keeping it in iCloud or on your laptop protects you even if this hosting account has a problem.
        </p>
        {list.length === 0 ? <Empty>No backups yet. The first nightly backup appears within a day, or download one now.</Empty> : (
          <ul className="list">
            {list.map((b) => (
              <li key={b.id} className="py-2.5 flex flex-wrap justify-between gap-3 t-small">
                <span><span className="font-medium">{fmtDateTime(b.createdAt, o.timezone)}</span> <span className="text-ink-2">{KIND[b.kind] ?? b.kind}, {items(b)} records, {size(b.sizeBytes)}</span></span>
                <a href={`/api/backup/download?id=${b.id}`} download>Download</a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Restore from a backup">
        <div className="panel p-4">
          <RestorePanel stored={list.map((b) => ({ id: b.id, label: `${fmtDateTime(b.createdAt, o.timezone)} (${KIND[b.kind] ?? b.kind})` }))} />
        </div>
      </Section>

      <Section title="Recently deleted">
        <p className="t-small text-ink-2 mb-4 prose-w">Deleted things stay here for {RETENTION_DAYS} days, then they're removed for good, including uploaded files. A document's full ID number is erased as soon as you delete the document; routines are deleted straight away.</p>
        {trash.length === 0 ? <Empty>Nothing deleted in the last {RETENTION_DAYS} days.</Empty> : (
          <ul className="list">
            {trash.map((x) => (
              <li key={`${x.kind}${x.id}`} className="py-2.5 flex flex-wrap items-center justify-between gap-3 t-small">
                <span><span className="text-ink-2">{x.label}:</span> <span className="font-medium">{x.name}</span> <span className="t-meta">deleted {fmtDateTime(x.deletedAt, o.timezone)}, gone for good after {fmtDateTime(x.purgeOn, o.timezone).slice(0, 10)}</span></span>
                <OpButton op="trash.restore" input={{ kind: x.kind, id: x.id }} label="Undo delete" className="btn btn-sm" />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
