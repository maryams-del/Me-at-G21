import { pageOwner, quranState, remindersFor } from "@/server/queries";
import { PageHeader, Section, Empty, ReminderList } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { fmtDate, fmtDateTime } from "@/lib/format";

const DAYS = [{ value: "1", label: "Monday" }, { value: "2", label: "Tuesday" }, { value: "3", label: "Wednesday" }, { value: "4", label: "Thursday" }, { value: "5", label: "Friday" }, { value: "6", label: "Saturday" }, { value: "7", label: "Sunday" }];
const eventFields = (withTitle = true): FieldDef[] => [
  ...(withTitle ? [{ name: "title", label: "Title", required: true } as FieldDef] : []),
  { name: "weekday", label: "Day", type: "select", required: true, options: DAYS, numeric: true },
  { name: "localTime", label: "Time (Saudi time)", type: "time", required: true },
  { name: "reminderLeadMinutes", label: "Remind me this many minutes before", type: "int", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
];

export default async function QuranPage() {
  const o = await pageOwner();
  const s = await quranState(o);
  const now = new Date();
  const cls = s.events.find((e) => e.kind === "class");
  const study = s.events.find((e) => e.kind === "study");
  const others = s.events.filter((e) => e !== cls && e !== study);
  const classOcc = cls ? s.occurrences.filter((x) => x.eventId === cls.id) : [];
  const upcoming = classOcc.filter((x) => x.startsAt > now);
  const past = classOcc.filter((x) => x.startsAt <= now).reverse();
  const next = upcoming.find((x) => x.status === "scheduled") ?? null;
  const hwFor = (id: string) => s.homework.filter((h) => h.occurrenceId === id);
  const rem = await remindersFor(o.id, "occurrence", s.occurrences.filter((x) => x.startsAt > now).map((x) => x.id));

  return (
    <>
      <PageHeader glyph="quran" title="Quran class" />

      {!cls ? <Empty>No class set up.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] mb-8">
          <section className="tile slate min-h-0 p-5" aria-labelledby="next-h">
            <h2 id="next-h" className="t-small">Next class</h2>
            {next ? (
              <>
                <p className="t-num text-[2.6rem] mt-2">{fmtDateTime(next.startsAt, o.timezone)}</p>
                <p className="t-small mt-1" style={{ opacity: 0.85 }}>Reminder {next.reminderLeadMinutes ?? cls.reminderLeadMinutes} minutes before{cls.remindersEnabled ? "" : " (reminders off)"}</p>
                <div className="mt-4 p-4" style={{ background: "var(--paper)", color: "var(--ink)", border: "1.5px solid var(--ink)" }}>
                  <h3 className="t-h3 mb-2">Homework for this class</h3>
                  <Homework items={hwFor(next.id)} />
                  <div className="mt-3">
                    <Reveal label="Add homework" buttonClass="btn btn-sm">
                      <OpForm op="homework.create" fixed={{ occurrenceId: next.id }} submitLabel="Add homework" fields={[
                        { name: "title", label: "What to do", required: true, wide: true, placeholder: "Learn the translation of…" },
                        { name: "reference", label: "Surah / verses", nullable: true, placeholder: "Al-Mulk 1–5" },
                        { name: "priority", label: "Priority", type: "select", options: [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }] },
                        { name: "description", label: "Details", type: "textarea", nullable: true }]} />
                    </Reveal>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Reveal label="This class only" buttonClass="btn btn-sm">
                    <OpForm op="occurrence.update" fixed={{ id: next.id, scope: "one" }} initial={{ status: next.status, reminderLeadMinutes: next.reminderLeadMinutes ?? "", prepNotes: next.prepNotes }} submitLabel="Save" fields={[
                      { name: "status", label: "Status", type: "select", required: true, options: [{ value: "scheduled", label: "Scheduled" }, { value: "cancelled", label: "Cancelled / skipped" }] },
                      { name: "reminderLeadMinutes", label: "Reminder minutes before (this class)", type: "int", nullable: true },
                      { name: "prepNotes", label: "Preparation notes", type: "textarea", nullable: true }]} />
                  </Reveal>
                  <OpButton op="occurrence.update" input={{ id: next.id, status: "cancelled", scope: "future" }} label="Stop from this class on" className="btn btn-sm btn-ghost" confirmText="Cancel this class and all future ones? Past classes and homework stay in your history." />
                </div>
              </>
            ) : <p className="t-small mt-2">No upcoming class. The series may be paused or ended.</p>}
          </section>

          <section className="panel p-5 grid gap-4 content-start" aria-labelledby="study-h">
            <h2 id="study-h" className="t-h2">Learn Quran translation</h2>
            {study ? (
              <>
                <p className="t-small text-ink-2">{study.paused ? "Suggested reminder, not active yet:" : "Weekly study reminder:"} {DAYS[study.weekday - 1].label} at {study.localTime}{study.reminderLeadMinutes ? `, ${study.reminderLeadMinutes} min early` : ""}.</p>
                {study.paused && <OpButton op="event.update" input={{ id: study.id, title: study.title, weekday: study.weekday, localTime: study.localTime, reminderLeadMinutes: study.reminderLeadMinutes, remindersEnabled: true, paused: false, linkedEventId: study.linkedEventId }} label="Activate this reminder" className="btn btn-primary" />}
                <Reveal label={study.paused ? "Change before activating" : "Change day or time"} buttonClass="btn btn-sm">
                  <OpForm op="event.update" fields={[...eventFields(false), { name: "paused", label: "Paused", type: "checkbox" }]} fixed={{ id: study.id, title: study.title, linkedEventId: study.linkedEventId }}
                    initial={{ ...study, weekday: String(study.weekday) }} submitLabel="Save" />
                </Reveal>
                {!study.paused && (() => {
                  const occ = s.occurrences.find((x) => x.eventId === study.id && x.status === "scheduled" && x.startsAt > new Date(now.getTime() - 3 * 86400_000));
                  return occ ? <OpButton op="occurrence.update" input={{ id: occ.id, status: "done", scope: "one" }} label={`Mark ${fmtDate(occ.localDate)} study done`} className="btn btn-sm" /> : null;
                })()}
              </>
            ) : <p className="t-meta">No study reminder set.</p>}
            <h3 className="t-h3 mt-2">Upcoming reminders</h3>
            <ReminderList items={rem.slice(0, 5)} tz={o.timezone} />
          </section>
        </div>
      )}

      {cls && (
        <Section title="Upcoming classes">
          <ul className="list panel px-4">
            {upcoming.map((x) => (
              <li key={x.id} className="py-2.5 flex flex-wrap justify-between items-center gap-3 t-small">
                <span style={{ textDecoration: x.status === "cancelled" ? "line-through" : undefined }}>{fmtDateTime(x.startsAt, o.timezone)} {x.status === "cancelled" && <span className="chip chip-rust">cancelled</span>} {hwFor(x.id).length > 0 && <span className="chip chip-fill">{hwFor(x.id).length} homework</span>}</span>
                {x.status === "scheduled"
                  ? <OpButton op="occurrence.update" input={{ id: x.id, status: "cancelled", scope: "one" }} label="Cancel this one" className="btn btn-sm btn-ghost" confirmText="Cancel only this class?" />
                  : x.status === "cancelled" ? <OpButton op="occurrence.update" input={{ id: x.id, status: "scheduled", scope: "one" }} label="Restore" className="btn btn-sm btn-ghost" /> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Past classes">
          <ul className="grid gap-3">
            {past.map((x) => (
              <li key={x.id} className="panel p-4">
                <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{fmtDate(x.localDate)}</p>
                  <div className="flex gap-2 items-center">{x.status !== "scheduled" && <span className="chip chip-fill">{x.status}</span>}
                    {x.status === "scheduled" && <OpButton op="occurrence.update" input={{ id: x.id, status: "attended", scope: "one" }} label="Mark attended" className="btn btn-sm btn-ghost" />}</div></div>
                {hwFor(x.id).length ? <div className="mt-2"><Homework items={hwFor(x.id)} /></div> : <p className="t-meta mt-1">No homework recorded.</p>}
                {x.prepNotes && <p className="t-small text-ink-2 mt-2">{x.prepNotes}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {cls && (
        <Section title="Class schedule">
          <div className="panel p-4">
            <OpForm op="event.update" fields={[...eventFields(), { name: "paused", label: "Pause the class", type: "checkbox" }]} fixed={{ id: cls.id }} initial={{ ...cls, weekday: String(cls.weekday) }} submitLabel="Save schedule" />
            <p className="t-meta mt-3">Default: every Sunday at 19:00 Saudi time, reminder 60 minutes before.</p>
          </div>
        </Section>
      )}

      <Section title="Other weekly commitments">
        {others.map((e) => <p key={e.id} className="t-small mb-2">{e.title}: {DAYS[e.weekday - 1].label} {e.localTime}</p>)}
        <Reveal label="Add a weekly class">
          <OpForm op="event.create" fields={eventFields()} fixed={{ kind: "class", startDate: new Date().toISOString().slice(0, 10) }} initial={{ weekday: "1", localTime: "18:00", reminderLeadMinutes: 60, remindersEnabled: true }} submitLabel="Create" />
        </Reveal>
      </Section>
    </>
  );
}

function Homework({ items }: { items: { id: string; title: string; reference: string | null; description: string | null; priority: string | null; completedAt: Date | null; dueAt: Date | null }[] }) {
  if (!items.length) return <p className="t-meta">No homework yet.</p>;
  return (
    <ul className="grid gap-1.5">
      {items.map((h) => (
        <li key={h.id} className="flex items-start gap-3">
          <OpButton op="homework.update" input={{ id: h.id, title: h.title, reference: h.reference, description: h.description, priority: h.priority, done: !h.completedAt }}
            label={h.completedAt ? "✓" : " "} ariaLabel={`${h.completedAt ? "Mark not done" : "Mark done"}: ${h.title}`} className="btn btn-sm w-9 px-0" successMessage={h.completedAt ? "Marked not done" : "Homework done"} />
          <span className="t-small pt-2" style={{ textDecoration: h.completedAt ? "line-through" : undefined }}>
            {h.title}{h.reference && <span className="text-ink-2"> ({h.reference})</span>}{h.priority === "high" && <span className="chip chip-rust ml-2">high</span>}
            {!h.reference && /translation|verse|surah|ayah/i.test(h.title) && <span className="t-meta block">Verses not added yet</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
