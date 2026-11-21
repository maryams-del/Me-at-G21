import { pageOwner, achievementsState } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PageHeader, Section, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { OpForm, OpButton, Reveal, ItemRow, type FieldDef } from "@/components/OpForm";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";
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
  const PATH = "/education/achievements";
  const params = { q: sp.q, kind: sp.kind, area: sp.area, tag: sp.tag, year: sp.year, featured: sp.featured };

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/education/achievements"><PageAddButton label="Add" choices={[{ key: "add", label: "Add achievement" }, { key: "hobby", label: "Add hobby" }]} /></SpaceHeader>

      <div className="toolbar">
        <SearchPill q={sp.q} placeholder="Search achievements" keep={{ kind: sp.kind, area: sp.area, tag: sp.tag, year: sp.year }} />
        <FilterPanel active={!!(sp.kind || sp.area || sp.tag || sp.year)}>
          <form className="panel p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end" aria-label="Filter achievements">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <FilterSelect label="Type" name="kind" value={sp.kind} options={[{ value: "", label: "All" }, ...ACHIEVEMENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
            <FilterSelect label="Area" name="area" value={sp.area} options={[{ value: "", label: "All" }, ...ACHIEVEMENT_AREAS.map((k) => ({ value: k, label: AREA_LABEL[k] }))]} />
            <FilterSelect label="Tag or skill" name="tag" value={sp.tag} options={[{ value: "", label: "All" }, ...d.tags.map((t) => ({ value: t, label: t }))]} />
            <FilterSelect label="Year" name="year" value={sp.year} options={[{ value: "", label: "Any" }, ...d.years.map((y) => ({ value: String(y), label: String(y) }))]} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
      </div>
      <FilterTags clearHref="/education/achievements" tags={[
        ...(sp.q ? [{ label: `“${sp.q}”`, href: withoutParam(PATH, params, "q") }] : []),
        ...(sp.kind ? [{ label: KIND_LABEL[sp.kind as keyof typeof KIND_LABEL] ?? sp.kind, href: withoutParam(PATH, params, "kind") }] : []),
        ...(sp.area ? [{ label: AREA_LABEL[sp.area as keyof typeof AREA_LABEL] ?? sp.area, href: withoutParam(PATH, params, "area") }] : []),
        ...(sp.tag ? [{ label: `#${sp.tag}`, href: withoutParam(PATH, params, "tag") }] : []),
        ...(sp.year ? [{ label: sp.year, href: withoutParam(PATH, params, "year") }] : []),
      ]} />
      <PageAddPanel title="Add achievement">
        <OpForm op="achievement.create" fields={fields} initial={{ kind: "accomplishment", area: "work" }} submitLabel="Save achievement" />
      </PageAddPanel>
      <PageAddPanel id="hobby" title="Add hobby">
        <OpForm op="hobby.create" fields={hobbyFields} initial={{ active: true }} submitLabel="Save hobby" compact />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-6" />

      <Section title={filtered ? `${rows.length} of ${d.total}` : "Achievements"}>
        {rows.length === 0 ? <Empty>{filtered ? "Nothing matches these filters." : "Nothing here yet. Add projects, awards, certifications, volunteering and results as they happen, so they're ready when you need them."}</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {rows.map((a) => (
              <li key={a.id} className="panel p-4 grid gap-2 content-start" style={a.featured ? { boxShadow: "inset 6px 0 0 var(--mustard)" } : undefined}>
                <ItemRow name={a.title}
                  head={<><h2 className="t-h3">{a.title}</h2><p className="t-meta">{[KIND_LABEL[a.kind], AREA_LABEL[a.area], a.organisation].filter(Boolean).join(", ")}</p></>}
                  aside={datesLabel(a) ? <p className="t-small text-right text-ink-2">{datesLabel(a)}</p> : undefined}
                  edit={<OpForm op="achievement.update" fields={fields} fixed={{ id: a.id }} compact submitLabel="Save"
                      initial={{ ...a, skillsText: a.skills.join(", "), tagsText: a.tags.join(", "), linksText: linksText(a.links) }}
                      deleteAction={{ op: "achievement.delete", input: { id: a.id }, confirm: `Delete “${a.title}”?`, label: "Delete" }} />}>
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
                </ItemRow>
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

      <Section title="Hobbies">
        {d.hobbies.length === 0 ? <Empty>No hobbies yet.</Empty> : (
          <ul className="list">
            {d.hobbies.map((h) => (
              <li key={h.id} className="py-3 grid gap-1">
                <ItemRow name={h.name}
                  head={<span className="t-small font-medium">{h.name}{h.level ? `, ${h.level}` : ""} {!h.active && <span className="chip chip-fill">paused</span>}</span>}
                  aside={h.since ? <span className="t-small text-ink-2">since {fmtDate(h.since)}</span> : undefined}
                  edit={<OpForm op="hobby.update" fields={hobbyFields} fixed={{ id: h.id }} initial={{ ...h, tagsText: h.tags.join(", "), linksText: linksText(h.links) }} submitLabel="Save" compact
                      deleteAction={{ op: "hobby.delete", input: { id: h.id }, confirm: `Delete “${h.name}”?`, label: "Delete" }} />}>
                {h.notes && <p className="t-small text-ink-2">{h.notes}</p>}
                {h.links.length > 0 && <p className="t-small">{h.links.map((l, n) => <span key={l.url}>{n ? ", " : ""}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>)}</p>}
                </ItemRow>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
