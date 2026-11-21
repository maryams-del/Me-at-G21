import { pageOwner, documentsState, documentStorageBytes, peopleList } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PeopleManager } from "../People";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { PageHeader, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { ItemRow } from "@/components/OpForm";
import { fmtDate } from "@/lib/format";
import { NewDocumentForm } from "./DocClient";
import { personOptions, personName, selfNameOf } from "@/lib/people";
import { docKindOptions, docTypesOf } from "@/lib/docTypes";

const SORTS = [{ value: "", label: "By type" }, { value: "expiry", label: "Expiring soonest" }, { value: "recent", label: "Recently updated" }];
const kb = (n: number) => (n === 0 ? "0 MB" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ add?: string; kind?: string; q?: string; sort?: string; reminders?: string; person?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const kindOpts = docKindOptions(docTypesOf(o.settings));
  // Filter list: every type, with "Other" for older documents saved before types could be named.
  const KINDS = [...kindOpts.filter((k) => k.value !== "other"), { value: "other", label: "Other" }];
  const kind = KINDS.some((k) => k.value === sp.kind) ? sp.kind : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const people = await peopleList(o.id);
  const selfName = selfNameOf(o);
  const whose = personOptions(selfName, people);
  const person = sp.person === "me" || people.some((p) => p.id === sp.person) ? sp.person : undefined;
  const personLabel = person === "me" ? selfName : people.find((p) => p.id === person)?.name;
  const reminders = sp.reminders === "on" || sp.reminders === "off" ? sp.reminders : undefined;
  const rows = await documentsState(o, { kind, q, sort: sp.sort, reminders, person });
  const filtered = !!(kind || q || reminders || person);
  const params = { q, kind, reminders, person, sort: sp.sort };
  const used = await documentStorageBytes(o.id);
  const LIMIT = 1024 * 1024 * 1024; // Vercel Blob free (Hobby) allowance
  const pct = Math.min(100, (used / LIMIT) * 100);
  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/admin/documents"><PageAddButton label="Add a document" /></SpaceHeader>
      <div className="toolbar">
        <SearchPill q={q} placeholder="Search documents" keep={{ kind, reminders, person, sort: sp.sort }} />
        <FilterPanel active={!!(kind || reminders || sp.sort)}>
          <form className="panel p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] items-end" role="search" aria-label="Filter documents">
            {q && <input type="hidden" name="q" value={q} />}
            <FilterSelect label="Reminders" name="reminders" value={reminders} options={[{ value: "", label: "All" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            <FilterSelect label="Person" name="person" value={person} options={[{ value: "", label: "Everyone" }, { value: "me", label: selfName }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
            <FilterSelect label="Type" name="kind" value={kind} options={[{ value: "", label: "All types" }, ...KINDS]} />
            <FilterSelect label="Sort" name="sort" value={sp.sort} options={SORTS} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
        <PeopleManager people={people} />
      </div>
      <FilterTags clearHref="/admin/documents" tags={[
        ...(q ? [{ label: `“${q}”`, href: withoutParam("/admin/documents", params, "q") }] : []),
        ...(person ? [{ label: personLabel ?? "Person", href: withoutParam("/admin/documents", params, "person") }] : []),
        ...(kind ? [{ label: KINDS.find((k) => k.value === kind)?.label ?? kind, href: withoutParam("/admin/documents", params, "kind") }] : []),
        ...(reminders ? [{ label: `Reminders ${reminders}`, href: withoutParam("/admin/documents", params, "reminders") }] : []),
        ...(sp.sort ? [{ label: SORTS.find((x) => x.value === sp.sort)?.label ?? sp.sort, href: withoutParam("/admin/documents", params, "sort") }] : []),
      ]} />
      <PageAddPanel title="Add a document">
        <NewDocumentForm whose={whose} kinds={kindOpts} />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />
      <div className="mb-6 grid gap-1 max-w-md" aria-label="File storage used">
        <div className="flex justify-between t-small"><span>File storage</span><span>{kb(used)} used of 1 GB</span></div>
        <div className="bar" role="img" aria-label={`${pct.toFixed(1)}% used`}><i style={{ width: `${Math.max(pct, used ? 0.5 : 0)}%`, background: pct > 80 ? "var(--rust)" : "var(--ink)" }} /></div>
        {pct > 80 && <p className="t-small" style={{ color: "var(--danger)" }}>Nearly full. Delete old file versions you don&apos;t need; going over the free limit pauses file access for up to 30 days.</p>}
      </div>
      {rows.length === 0 ? (filtered ? <Empty>No documents match{personLabel ? ` for ${personLabel}` : ""}{kind ? ` type “${KINDS.find((k) => k.value === kind)?.label}”` : ""}{q ? ` “${q}”` : ""}.</Empty> : <Empty>No documents yet. Add your passport, national ID, transcripts, certificates or CV versions.</Empty>) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ doc: d, files }) => {
            const latest = files[0];
            const who = d.personId ? personName(d.personId, selfName, people) : d.title;
            const kindLabel = KINDS.find((k) => k.value === d.kind)?.label;
            const when = d.expiresOn ? `Expires ${fmtDate(d.expiresOn)}` : d.issuedOn ? `Issued ${fmtDate(d.issuedOn)}` : "";
            return (
            <li key={d.id} className="panel p-4 grid gap-2 content-start">
              <ItemRow del={{ op: "document.delete", input: { id: d.id }, confirm: `Delete ${who}’s ${kindLabel ?? "document"}, its ID number and all its files?`, label: "Delete document" }} name={`${who} ${kindLabel ?? ""}`.trim()}
                head={<><h2 className="t-h3 min-w-0 truncate">{who}</h2><p className="t-meta">{[kindLabel !== who ? kindLabel : null, when].filter(Boolean).join(" · ")}</p></>}
                editHref={`/admin/documents/${d.id}`}>
              {latest
                ? <a className="t-small inline-flex items-center gap-1.5 underline underline-offset-4 min-w-0 max-w-full justify-self-start self-start w-fit" href={`/file/${latest.id}`} target="_blank" rel="noopener">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
                    <span className="truncate">{latest.filename}</span></a>
                : <p className="t-meta">No file attached</p>}
              </ItemRow>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
