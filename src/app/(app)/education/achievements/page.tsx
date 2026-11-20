import { pageOwner, achievementsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef, EditPanel } from "@/components/OpForm";
import { ACHIEVEMENT_KINDS, ACHIEVEMENT_AREAS } from "@/db/schema";
import { datesLabel } from "@/server/ops/career";
import { fmtDate } from "@/lib/format";
import { CvExport } from "./CvExport";

const KIND_LABEL: Record<string, string> = { accomplishment: "Accomplishment", project: "Project", award: "Award", certification: "Certification", volunteering: "Volunteering", skill: "Skill", publication: "Publication", other: "Other" };
const AREA_LABEL: Record<string, string> = { work: "Work", academic: "Academic", personal: "Personal", community: "Community" };

type Data = Awaited<ReturnType<typeof achievementsState>>;
const achievementFields = (d: Data): FieldDef[] => [
  { name: "title", label: "What you did", required: true, placeholder: "Led the redesign of the onboarding flow", wide: true },
  { name: "kind", label: "Type", type: "select", required: true, options: ACHIEVEMENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) },
  { name: "area", label: "Area", type: "select", required: true, options: ACHIEVEMENT_AREAS.map((k) => ({ value: k, label: AREA_LABEL[k] })) },
  { name: "organisation", label: "Where / with whom", nullable: true },
  { name: "startDate", label: "Started", type: "date", nullable: true },
  { name: "endDate", label: "Finished / awarded", type: "date", nullable: true },
  { name: "description", label: "Details", type: "textarea", nullable: true },
  { name: "outcome", label: "Outcome and numbers", type: "textarea", nullable: true, help: "Only results you can back up, e.g. “cut load time from 4s to 1.5s”." },
  { name: "summary", label: "CV line (your words)", type: "textarea", nullable: true, help: "Used as the bullet when you export. Leave empty to build it from the title and outcome." },
  { name: "skillsText", label: "Skills used", nullable: true, placeholder: "Figma, user research, SQL" },
  { name: "tagsText", label: "Tags", nullable: true, placeholder: "portfolio, leadership" },
  { name: "linksText", label: "Links", type: "textarea", nullable: true, help: "One per line: “Label | https://…” or just the link." },
  { name: "projectId", label: "Linked project", type: "select", nullable: true, options: d.projects.map((p) => ({ value: p.id, label: `${p.name}${p.status === "done" ? " (done)" : ""}` })) },
  { name: "applicationId", label: "Linked master's application", type: "select", nullable: true, options: d.applications.map((a) => ({ value: a.id, label: `${a.university}: ${a.program}` })) },
  ...(d.documents.length ? [{ name: "documentIds", label: "Attached from Documents & IDs (certificates, photos)", type: "checks" as const, options: d.documents.map((x) => ({ value: x.id, label: x.title })) }] : []),
  { name: "featured", label: "Featured (shown first and in portfolio exports)", type: "checkbox", wide: true },
];
const hobbyFields: FieldDef[] = [
  { name: "name", label: "Hobby", required: true, placeholder: "Calligraphy" },
  { name: "level", label: "Level", nullable: true, placeholder: "Intermediate" },
  { name: "since", label: "Since", type: "date", nullable: true },
  { name: "tagsText", label: "Tags", nullable: true },
  { name: "linksText", label: "Links", type: "textarea", nullable: true },
  { name: "notes", label: "Notes", type: "textarea", nullable: true },
  { name: "active", label: "Still doing it", type: "checkbox" },
];
const linksText = (ls: { label: string; url: string }[]) => ls.map((l) => `${l.label} | ${l.url}`).join("\n");

export default async function AchievementsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; area?: string; tag?: string; year?: string; featured?: string; add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const d = await achievementsState(o, sp);
  const fields = achievementFields(d);
  const filtered = !!(sp.q || sp.kind || sp.area || sp.tag || sp.year);
  const rows = sp.featured === "1" ? d.rows.filter((r) => r.featured) : d.rows;
  const cv = rows.map((r) => r.bullet).join("\n");

  return (
    <>
      <PageHeader glyph="achievements" title="Achievements & hobbies" />

      <div className="mb-6"><Reveal label="Add achievement" open={sp.add === "1"}>
        <OpForm op="achievement.create" fields={fields} initial={{ kind: "accomplishment", area: "work" }} submitLabel="Save achievement" />
      </Reveal></div>

      <form className="panel p-3 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto_auto] items-end" role="search" aria-label="Filter achievements">
        <label className="field"><span className="label">Search</span><input name="q" defaultValue={sp.q} className="input" placeholder="e.g. hackathon design" /></label>
        <label className="field"><span className="label">Type</span><select name="kind" defaultValue={sp.kind ?? ""} className="select"><option value="">All</option>{ACHIEVEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <label className="field"><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="select"><option value="">All</option>{ACHIEVEMENT_AREAS.map((k) => <option key={k} value={k}>{AREA_LABEL[k]}</option>)}</select></label>
        <label className="field"><span className="label">Tag or skill</span><select name="tag" defaultValue={sp.tag ?? ""} className="select"><option value="">All</option>{d.tags.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="field"><span className="label">Year</span><select name="year" defaultValue={sp.year ?? ""} className="select"><option value="">Any</option>{d.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button className="btn">Apply</button>
        {filtered && <a href="/education/achievements" className="btn btn-ghost">Clear</a>}
      </form>

      <Section title={filtered ? `${rows.length} of ${d.total}` : "Achievements"}>
        {rows.length === 0 ? <Empty>{filtered ? "Nothing matches these filters." : "Nothing here yet. Add projects, awards, certifications, volunteering and results as they happen, so they're ready when you need them."}</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {rows.map((a) => (
              <li key={a.id} className="panel p-4 grid gap-2 content-start" style={a.featured ? { boxShadow: "inset 6px 0 0 var(--mustard)" } : undefined}>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="t-h3">{a.title}</h2>
                    <p className="t-meta">{[KIND_LABEL[a.kind], AREA_LABEL[a.area], a.organisation].filter(Boolean).join(", ")}</p>
                  </div>
                  {datesLabel(a) && <p className="t-small text-right text-ink-2 shrink-0">{datesLabel(a)}</p>}
                </div>
                {a.outcome && <p className="t-small"><span className="font-medium">Outcome:</span> {a.outcome}</p>}
                {a.description && <p className="t-small text-ink-2 whitespace-pre-line">{a.description}</p>}
                {(a.skills.length > 0 || a.tags.length > 0) && <div className="flex flex-wrap gap-1.5">{a.skills.map((x) => <span key={`s${x}`} className="chip chip-fill">{x}</span>)}{a.tags.map((x) => <span key={`t${x}`} className="chip">#{x}</span>)}</div>}
                {(a.project || a.application || a.links.length > 0 || a.docs.length > 0) && (
                  <ul className="t-small grid gap-0.5">
                    {a.project && <li>Project: <a href="/projects">{a.project.name}</a></li>}
                    {a.application && <li>Application: <a href={`/education/applications/${a.application.id}`}>{a.application.university}</a></li>}
                    {a.docs.map((x) => <li key={x.id}>Attached: <a href="/admin/documents">{x.title}</a></li>)}
                    {a.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></li>)}
                  </ul>
                )}
                <EditPanel>
                    <OpForm op="achievement.update" fields={fields} fixed={{ id: a.id }} compact submitLabel="Save"
                      initial={{ ...a, skillsText: a.skills.join(", "), tagsText: a.tags.join(", "), linksText: linksText(a.links) }} />
                    <OpButton op="achievement.delete" input={{ id: a.id }} label="Delete" className="btn btn-sm btn-ghost justify-self-start" confirmText={`Delete “${a.title}”?`} />
                  </EditPanel>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {rows.length > 0 && (
        <Section title="CV / portfolio bullets" aside={<a href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "featured" && k !== "add")), ...(sp.featured === "1" ? {} : { featured: "1" }) })}`} className="t-small">{sp.featured === "1" ? "Show all" : "Featured only"}</a>}>
          <p className="t-small text-ink-2 mb-3 prose-w">One line per achievement shown above, newest first. Each uses your CV line if you wrote one, otherwise the title and outcome you entered. Nothing is added.</p>
          <CvExport text={cv} filename="achievements.txt" />
        </Section>
      )}

      <Section title="Hobbies" aside={<Reveal label="Add hobby"><OpForm op="hobby.create" fields={hobbyFields} initial={{ active: true }} submitLabel="Save hobby" compact /></Reveal>}>
        {d.hobbies.length === 0 ? <Empty>No hobbies yet.</Empty> : (
          <ul className="list">
            {d.hobbies.map((h) => (
              <li key={h.id} className="py-3 grid gap-1">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="t-small font-medium">{h.name}{h.level ? `, ${h.level}` : ""} {!h.active && <span className="chip chip-fill">paused</span>}</span>
                  {h.since && <span className="t-small text-ink-2">since {fmtDate(h.since)}</span>}
                </div>
                {h.notes && <p className="t-small text-ink-2">{h.notes}</p>}
                {h.links.length > 0 && <p className="t-small">{h.links.map((l, n) => <span key={l.url}>{n ? ", " : ""}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>)}</p>}
                <EditPanel>
                    <OpForm op="hobby.update" fields={hobbyFields} fixed={{ id: h.id }} initial={{ ...h, tagsText: h.tags.join(", "), linksText: linksText(h.links) }} submitLabel="Save" compact />
                    <OpButton op="hobby.delete" input={{ id: h.id }} label="Delete" className="btn btn-sm btn-ghost justify-self-start" confirmText={`Delete “${h.name}”?`} />
                  </EditPanel>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
