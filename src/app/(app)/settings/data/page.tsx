import { and, desc, eq, like } from "drizzle-orm";
import { pageOwner } from "@/server/queries";
import { getDb } from "@/db";
import { backups, documentFiles } from "@/db/schema";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpButton } from "@/components/OpForm";
import { CSV_MODULES } from "@/server/csv";
import { listTrash, RETENTION_DAYS } from "@/server/ops/trash";
import { KEEP_AUTOMATIC } from "@/server/backup";
import { fmtDateTime } from "@/lib/format";
import { PrivateCsvLink, RestorePanel, FullBackupPanel } from "./DataClient";

const KIND: Record<string, string> = { automatic: "Nightly", manual: "Made by you", "pre-restore": "Safety copy before a restore" };
const size = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export default async function DataPage() {
  const o = await pageOwner();
  const [list, trash, pendingRows] = await Promise.all([
    getDb().select().from(backups).where(and(eq(backups.ownerId, o.id))).orderBy(desc(backups.createdAt)).limit(40),
    listTrash(o.id),
    getDb().select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.ownerId, o.id), like(documentFiles.storageKey, "pending:%"))),
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

      <div id="full-backup" className="scroll-mt-6" />
      <Section title="Full backup (with your documents)">
        <div className="panel p-4 grid gap-4">
          <p className="t-small prose-w">Everything in one file: all your records <strong>and</strong> every uploaded document, locked with a password you choose. Your browser builds it, so the password never leaves this device. It doesn't depend on anything stored on the server, so it can be restored even into a brand-new installation of the app.</p>
          <p className="t-small text-ink-2 prose-w">Keep the file in iCloud or on your laptop, and the password in your password manager or with your recovery codes. Make a new one every month or two, and after adding important documents. On a phone, large backups can take a while; a laptop is faster.</p>
          <FullBackupPanel />
        </div>
      </Section>

      <Section title="Quick backups" aside={<a className="btn" href="/api/backup/download?id=new" download>Download a quick backup</a>}>
        <p className="t-small text-ink-2 mb-4 prose-w">
          Records only (not document files), made automatically every night; the last {KEEP_AUTOMATIC} are kept. They're for undoing a mistake inside this app, and can only be opened by this installation. For a copy you keep yourself, use the full backup above.
        </p>
        {list.length === 0 ? <Empty>No quick backups yet. The first nightly one appears within the hour.</Empty> : (
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
        <div className="panel p-4 grid gap-3">
          {pendingRows.length > 0 && <p role="alert" className="error">{pendingRows.length} document file{pendingRows.length === 1 ? " is" : "s are"} still waiting from your last full-backup restore. Choose that backup file below, enter its password, press “Check backup”, then “Only restore the missing document files”.</p>}
          <RestorePanel pending={pendingRows.length} stored={list.map((b) => ({ id: b.id, label: `${fmtDateTime(b.createdAt, o.timezone)} (${KIND[b.kind] ?? b.kind})` }))} />
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
