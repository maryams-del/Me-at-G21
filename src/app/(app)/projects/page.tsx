import { pageOwner, projectsState } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, ItemRow, type FieldDef } from "@/components/OpForm";
import { fmtDate } from "@/lib/format";

const COLS = [{ key: "backlog", label: "Backlog" }, { key: "in_progress", label: "In progress" }, { key: "done", label: "Done" }] as const;
const prio = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ add?: string; view?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await projectsState(o);
  const projOpts = s.projects.filter((p) => p.status === "active").map((p) => ({ value: p.id, label: p.name }));
  const taskFields: FieldDef[] = [
    { name: "title", label: "Task", required: true, wide: true },
    { name: "projectId", label: "Project", type: "select", options: projOpts, nullable: true },
    { name: "status", label: "Status", type: "select", required: true, options: COLS.map((c) => ({ value: c.key, label: c.label })) },
    { name: "dueOn", label: "Due date", type: "date", nullable: true },
    { name: "dueTime", label: "Due time", type: "time", nullable: true },
    { name: "priority", label: "Priority", type: "select", options: prio, nullable: true },
    { name: "reminderOffsetsDays", label: "Remind me before", type: "intlist", negative: true, presets: [7, 3, 1, 0], maxDays: 60, maxCount: 6 },
    { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
    { name: "notes", label: "Notes", type: "textarea", nullable: true },
  ];
  const byDeadline = [...s.tasks].filter((t) => t.status !== "done").sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const view = sp.view === "board" ? "board" : "list";
  const projName = (id: string | null) => s.projects.find((p) => p.id === id)?.name;

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1" ? "task" : null}>
      <SpaceHeader href="/projects">
        <a href="?view=list" className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`} aria-current={view === "list" ? "page" : undefined}>By deadline</a>
        <a href="?view=board" className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} aria-current={view === "board" ? "page" : undefined}>Board</a>
        <PageAddButton label="Add" choices={[{ key: "task", label: "Add task" }, { key: "project", label: "New project" }]} />
      </SpaceHeader>
      <PageAddPanel id="task" title="Add task">
        <OpForm op="task.create" fields={taskFields} initial={{ status: "backlog", reminderOffsetsDays: "0", remindersEnabled: true }} submitLabel="Add task" />
      </PageAddPanel>
      <PageAddPanel id="project" title="New project">
        <OpForm op="project.create" submitLabel="Create project" fields={[
            { name: "name", label: "Project", required: true, placeholder: "Update my portfolio website" },
            { name: "targetDate", label: "Target date", type: "date", nullable: true },
            { name: "priority", label: "Priority", type: "select", options: prio, nullable: true },
            { name: "description", label: "Description", type: "textarea", nullable: true }]} />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />

      {view === "list" ? (
        <Section title="Open tasks by deadline">
          {byDeadline.length ? <ul className="list panel px-4">{byDeadline.map((t) => <TaskRow key={t.id} t={t} today={s.today} project={projName(t.projectId)} fields={taskFields} />)}</ul> : <Empty>No open tasks.</Empty>}
        </Section>
      ) : (
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {COLS.map((c) => (
            <section key={c.key} className="panel p-3" aria-label={c.label}>
              <h2 className="t-h3 px-1 pb-2 rule-b mb-1">{c.label} <span className="t-meta">{s.tasks.filter((t) => t.status === c.key).length}</span></h2>
              <ul className="list">{s.tasks.filter((t) => t.status === c.key).slice(0, 40).map((t) => <TaskRow key={t.id} t={t} today={s.today} project={projName(t.projectId)} fields={taskFields} board />)}</ul>
            </section>
          ))}
        </div>
      )}

      <Section title="Projects">
        {s.projects.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {s.projects.map((p) => {
              const ts = s.tasks.filter((t) => t.projectId === p.id);
              const done = ts.filter((t) => t.status === "done").length;
              return (
                <li key={p.id} className="panel p-4 grid gap-2">
                  <ItemRow name={p.name} head={<h3 className="t-h3">{p.name}</h3>} aside={p.status !== "active" ? <span className="chip chip-pine">{p.status}</span> : undefined}
                    edit={<OpForm op="project.update" fixed={{ id: p.id }} initial={p} submitLabel="Save project" fields={[
                      { name: "name", label: "Project", required: true }, { name: "status", label: "Status", type: "select", required: true, options: [{ value: "active", label: "Active" }, { value: "done", label: "Done" }, { value: "archived", label: "Archived" }] },
                      { name: "targetDate", label: "Target date", type: "date", nullable: true }, { name: "priority", label: "Priority", type: "select", options: prio, nullable: true },
                      { name: "description", label: "Description", type: "textarea", nullable: true }]} />} />
                  {p.description && <p className="t-small text-ink-2">{p.description}</p>}
                  <p className="t-meta">{done}/{ts.length} tasks done{p.targetDate ? `, target ${fmtDate(p.targetDate)}` : ""}</p>
                  <div className="bar"><i style={{ width: `${ts.length ? (done / ts.length) * 100 : 0}%` }} /></div>
                </li>
              );
            })}
          </ul>
        ) : <Empty>No projects yet.</Empty>}
      </Section>
    </>
  );
}

type T = Awaited<ReturnType<typeof projectsState>>["tasks"][number];
function TaskRow({ t, today, project, fields, board }: { t: T; today: string; project?: string; fields: FieldDef[]; board?: boolean }) {
  const over = t.status !== "done" && t.dueOn && t.dueOn < today;
  return (
    <li className="py-2.5 grid gap-1">
      <ItemRow del={{ op: "task.delete", input: { id: t.id }, confirm: `Delete “${t.title}”?`, label: "Delete task" }} name={t.title}
        head={<div className="flex items-start gap-3">
          <OpButton op="task.complete" input={{ id: t.id, done: t.status !== "done" }} label={t.status === "done" ? "✓" : " "} ariaLabel={`${t.status === "done" ? "Reopen" : "Complete"}: ${t.title}`} className="btn btn-sm w-9 px-0 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="t-small font-medium" style={{ textDecoration: t.status === "done" ? "line-through" : undefined }}>{t.title}</p>
            <p className="t-meta" style={over ? { color: "var(--danger)" } : undefined}>{[project, t.dueOn && `due ${fmtDate(t.dueOn)}${t.dueTime ? ` ${t.dueTime}` : ""}`, t.priority === "high" && "high priority", !board && t.status === "in_progress" && "in progress"].filter(Boolean).join(", ")}</p>
          </div>
        </div>}
        edit={<OpForm op="task.update" fields={fields} fixed={{ id: t.id, checklist: t.checklist }} initial={t} submitLabel="Save task" compact
          deleteAction={{ op: "task.delete", input: { id: t.id }, confirm: `Delete “${t.title}”?`, label: "Delete task" }} />} />
    </li>
  );
}
