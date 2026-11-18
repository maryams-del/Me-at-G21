import { z } from "zod";
import { and, asc, eq, gte, isNull, inArray } from "drizzle-orm";
import { projects, tasks, recurringEvents, eventOccurrences, homeworkTasks, mastersApplications } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { addDays, localToInstant, nextWeekday, todayLocal, type LocalDate, dmy } from "@/lib/time";
import { syncReminders, cancelReminders } from "../reminders";

/* ───────────── Projects & tasks ───────────── */

export const projectCreate = defineOp({
  name: "project.create", module: "projects", label: "New project", aiAllowed: true,
  schema: z.object({
    name: zText(200), description: zOptText(), targetDate: zDate.optional().nullable(),
    priority: z.enum(["low", "medium", "high"]).optional().nullable(), links: z.array(z.string().url()).max(20).default([]),
  }),
  summarize: (i) => `Create project “${i.name}”${i.targetDate ? ` (target ${dmy(i.targetDate)})` : ""}`,
  async run(ctx, i) {
    const [p] = await ctx.tx.insert(projects).values({ ownerId: ctx.ownerId, name: i.name, description: i.description, targetDate: i.targetDate ?? null, priority: i.priority ?? null, links: i.links, source: ctx.source }).returning({ id: projects.id });
    await audit(ctx, "projects", "created", "project", p.id, `Created project “${i.name}”`);
    return { id: p.id, message: `Project “${i.name}” created` };
  },
});

export const projectUpdate = defineOp({
  name: "project.update", module: "projects", label: "Edit project", aiAllowed: false,
  schema: z.object({
    id: zId, name: zText(200), description: zOptText(), targetDate: zDate.optional().nullable(),
    priority: z.enum(["low", "medium", "high"]).optional().nullable(), status: z.enum(["active", "done", "archived"]),
    links: z.array(z.string().url()).max(20).default([]),
  }),
  summarize: (i) => `Update project “${i.name}”`,
  async run(ctx, i) {
    const res = await ctx.tx.update(projects).set({ name: i.name, description: i.description, targetDate: i.targetDate ?? null, priority: i.priority ?? null, status: i.status, links: i.links, updatedAt: ctx.now })
      .where(and(eq(projects.id, i.id), eq(projects.ownerId, ctx.ownerId), isNull(projects.deletedAt))).returning({ id: projects.id });
    if (!res.length) throw new UserError("Project not found");
    await audit(ctx, "projects", i.status === "done" ? "completed" : "edited", "project", i.id, `${i.status === "done" ? "Completed" : "Edited"} project “${i.name}”`);
    return { id: i.id, message: "Project saved" };
  },
});

async function syncTaskReminders(ctx: Ctx, taskId: string) {
  const [t] = await ctx.tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t || t.status === "done" || t.deletedAt || !t.dueOn || !t.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, "task", taskId);
  const time = t.dueTime ?? t.reminderTime;
  await syncReminders(ctx.tx, ctx.ownerId, "task", t.id, t.reminderOffsetsDays.map((off) => ({
    dedupeKey: `task:${t.id}:${t.dueOn}:${time}:o${off}`,
    fireAt: localToInstant(addDays(t.dueOn!, off), time, ctx.tz),
    title: t.title,
    publicBody: off === 0 ? `Due today${t.dueTime ? ` at ${t.dueTime}` : ""}` : `Due in ${-off} day${off === -1 ? "" : "s"}`,
    link: "/projects",
  })), ctx.now);
}

const taskInput = z.object({
  title: zText(300), projectId: zId.optional().nullable(), applicationId: zId.optional().nullable(), notes: zOptText(),
  status: z.enum(["backlog", "in_progress", "done"]).default("backlog"),
  dueOn: zDate.optional().nullable(), dueTime: zTime.optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  checklist: z.array(z.object({ text: zText(300), done: z.boolean() })).max(50).default([]),
  reminderOffsetsDays: z.array(z.number().int().min(-60).max(0)).max(6).default([0]),
  remindersEnabled: z.boolean().default(true),
});

export const taskCreate = defineOp({
  name: "task.create", module: "projects", label: "Add task", aiAllowed: true,
  schema: taskInput, draftable: ["dueOn"],
  summarize: (i) => `Add task “${i.title}”${i.dueOn ? ` due ${dmy(i.dueOn)}${i.dueTime ? ` ${i.dueTime}` : ""}` : ""}${i.dueOn && i.remindersEnabled ? " with reminder" : ""}`,
  async run(ctx, i) {
    if (i.projectId) {
      const [p] = await ctx.tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, i.projectId), eq(projects.ownerId, ctx.ownerId)));
      if (!p) throw new UserError("Project not found", "projectId");
    }
    if (i.applicationId) {
      const [a] = await ctx.tx.select({ id: mastersApplications.id }).from(mastersApplications).where(and(eq(mastersApplications.id, i.applicationId), eq(mastersApplications.ownerId, ctx.ownerId)));
      if (!a) throw new UserError("Application not found", "applicationId");
    }
    const [t] = await ctx.tx.insert(tasks).values({
      ownerId: ctx.ownerId, projectId: i.projectId ?? null, applicationId: i.applicationId ?? null, title: i.title, notes: i.notes, status: i.status,
      dueOn: i.dueOn ?? null, dueTime: i.dueTime ?? null, priority: i.priority ?? null, checklist: i.checklist,
      reminderOffsetsDays: i.reminderOffsetsDays, remindersEnabled: i.remindersEnabled,
      completedAt: i.status === "done" ? ctx.now : null, source: ctx.source,
    }).returning({ id: tasks.id });
    await syncTaskReminders(ctx, t.id);
    await audit(ctx, "projects", "created", "task", t.id, `Added task “${i.title}”`);
    return { id: t.id, message: `Task “${i.title}” added` };
  },
});

export const taskUpdate = defineOp({
  name: "task.update", module: "projects", label: "Edit task", aiAllowed: false,
  schema: taskInput.extend({ id: zId }),
  summarize: (i) => `Update task “${i.title}”`,
  async run(ctx, i) {
    const [cur] = await ctx.tx.select().from(tasks).where(and(eq(tasks.id, i.id), eq(tasks.ownerId, ctx.ownerId), isNull(tasks.deletedAt)));
    if (!cur) throw new UserError("Task not found");
    const completedAt = i.status === "done" ? (cur.completedAt ?? ctx.now) : null;
    await ctx.tx.update(tasks).set({
      projectId: i.projectId ?? null, applicationId: i.applicationId ?? cur.applicationId, title: i.title, notes: i.notes, status: i.status, dueOn: i.dueOn ?? null, dueTime: i.dueTime ?? null,
      priority: i.priority ?? null, checklist: i.checklist, reminderOffsetsDays: i.reminderOffsetsDays, remindersEnabled: i.remindersEnabled,
      completedAt, updatedAt: ctx.now,
    }).where(eq(tasks.id, i.id));
    await syncTaskReminders(ctx, i.id);
    await audit(ctx, "projects", i.status === "done" && cur.status !== "done" ? "completed" : "edited", "task", i.id, `${i.status === "done" && cur.status !== "done" ? "Completed" : "Edited"} task “${i.title}”`);
    return { id: i.id, message: "Task saved" };
  },
});

export const taskComplete = defineOp({
  name: "task.complete", module: "projects", label: "Complete task", aiAllowed: true,
  schema: z.object({ id: zId, done: z.boolean().default(true) }),
  summarize: (i) => (i.done ? "Mark task done" : "Reopen task"),
  async run(ctx, i) {
    const res = await ctx.tx.update(tasks).set({ status: i.done ? "done" : "in_progress", completedAt: i.done ? ctx.now : null, updatedAt: ctx.now })
      .where(and(eq(tasks.id, i.id), eq(tasks.ownerId, ctx.ownerId), isNull(tasks.deletedAt))).returning({ title: tasks.title });
    if (!res.length) throw new UserError("Task not found");
    await syncTaskReminders(ctx, i.id);
    await audit(ctx, "projects", i.done ? "completed" : "reopened", "task", i.id, `${i.done ? "Completed" : "Reopened"} “${res[0].title}”`);
    return { id: i.id, message: i.done ? "Done" : "Reopened" };
  },
});

export const taskDelete = defineOp({
  name: "task.delete", module: "projects", label: "Delete task", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete task",
  async run(ctx, i) {
    const res = await ctx.tx.update(tasks).set({ deletedAt: ctx.now }).where(and(eq(tasks.id, i.id), eq(tasks.ownerId, ctx.ownerId), isNull(tasks.deletedAt))).returning({ title: tasks.title });
    if (!res.length) throw new UserError("Task not found");
    await cancelReminders(ctx.tx, ctx.ownerId, "task", i.id);
    await audit(ctx, "projects", "deleted", "task", i.id, `Deleted task “${res[0].title}”`);
    return { id: i.id, message: "Task deleted" };
  },
});

/* ───────────── Recurring events: Quran class, translation study, other classes ───────────── */

type EventRow = typeof recurringEvents.$inferSelect;
const HORIZON_WEEKS = 8;

/** Weekly local dates for an event from `from` (inclusive) for `weeks` weeks. Pure. */
export function weeklyDates(ev: Pick<EventRow, "weekday" | "startDate" | "endDate">, from: LocalDate, weeks: number): LocalDate[] {
  const start = from > ev.startDate ? from : ev.startDate;
  const out: LocalDate[] = [];
  let d = nextWeekday(start, ev.weekday);
  for (let k = 0; k < weeks; k++) {
    if (ev.endDate && d > ev.endDate) break;
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

/** Materialise upcoming occurrences (idempotent) and sync their reminders. */
export async function ensureOccurrences(ctx: Ctx, eventId: string) {
  const [ev] = await ctx.tx.select().from(recurringEvents).where(and(eq(recurringEvents.id, eventId), eq(recurringEvents.ownerId, ctx.ownerId)));
  if (!ev) return;
  const today = todayLocal(ctx.tz, ctx.now);
  if (!ev.paused) {
    for (const date of weeklyDates(ev, today, HORIZON_WEEKS)) {
      await ctx.tx.insert(eventOccurrences).values({
        ownerId: ctx.ownerId, eventId: ev.id, localDate: date, startsAt: localToInstant(date, ev.localTime, ev.timezone),
      }).onConflictDoNothing();
    }
  }
  const upcoming = await ctx.tx.select().from(eventOccurrences)
    .where(and(eq(eventOccurrences.eventId, ev.id), gte(eventOccurrences.localDate, today)));
  for (const o of upcoming) await syncOccurrenceReminder(ctx, ev, o);
}

async function syncOccurrenceReminder(ctx: Ctx, ev: EventRow, o: typeof eventOccurrences.$inferSelect) {
  if (ev.paused || !ev.remindersEnabled || o.status !== "scheduled") return cancelReminders(ctx.tx, ctx.ownerId, "occurrence", o.id);
  const lead = o.reminderLeadMinutes ?? ev.reminderLeadMinutes;
  const fireAt = new Date(o.startsAt.getTime() - lead * 60_000);
  const isStudy = ev.kind === "study";
  await syncReminders(ctx.tx, ctx.ownerId, "occurrence", o.id, [{
    dedupeKey: `occ:${o.id}:${o.startsAt.toISOString()}:l${lead}`,
    fireAt,
    title: isStudy ? ev.title : `${ev.title} ${lead === 0 ? "now" : `in ${lead >= 60 && lead % 60 === 0 ? `${lead / 60} hour${lead === 60 ? "" : "s"}` : `${lead} min`}`}`,
    publicBody: isStudy ? "Study reminder" : `Starts at ${ev.localTime}`,
    link: "/quran",
  }], ctx.now);
}

const eventInput = z.object({
  kind: z.enum(["class", "study"]).default("class"), title: zText(120),
  weekday: z.number().int().min(1).max(7), localTime: zTime, durationMinutes: z.number().int().min(5).max(600).default(60),
  startDate: zDate, reminderLeadMinutes: z.number().int().min(0).max(10080), remindersEnabled: z.boolean().default(true),
  linkedEventId: zId.optional().nullable(), notes: zOptText(),
});

export const eventCreate = defineOp({
  name: "event.create", module: "quran", label: "New recurring class", aiAllowed: false,
  schema: eventInput,
  summarize: (i) => `Create weekly “${i.title}”`,
  async run(ctx, i) {
    const [ev] = await ctx.tx.insert(recurringEvents).values({ ownerId: ctx.ownerId, ...i, linkedEventId: i.linkedEventId ?? null, timezone: ctx.tz }).returning({ id: recurringEvents.id });
    await ensureOccurrences(ctx, ev.id);
    await audit(ctx, "quran", "created", "recurring_event", ev.id, `Created weekly “${i.title}”`);
    return { id: ev.id, message: `“${i.title}” created` };
  },
});

export const eventUpdate = defineOp({
  name: "event.update", module: "quran", label: "Edit recurring class", aiAllowed: false,
  schema: eventInput.omit({ kind: true, startDate: true }).extend({ id: zId, paused: z.boolean().default(false) }),
  summarize: (i) => `Update “${i.title}”`,
  async run(ctx, i) {
    const { id: eid, ...rest } = i;
    const [cur] = await ctx.tx.select().from(recurringEvents).where(and(eq(recurringEvents.id, eid), eq(recurringEvents.ownerId, ctx.ownerId)));
    if (!cur) throw new UserError("Not found");
    await ctx.tx.update(recurringEvents).set({ ...rest, linkedEventId: rest.linkedEventId ?? null, updatedAt: ctx.now }).where(eq(recurringEvents.id, eid));
    // Schedule change: drop future *untouched* occurrences that no longer match, keep ones with homework/history.
    if (cur.weekday !== i.weekday || cur.localTime !== i.localTime) {
      const today = todayLocal(ctx.tz, ctx.now);
      const future = await ctx.tx.select().from(eventOccurrences).where(and(eq(eventOccurrences.eventId, eid), gte(eventOccurrences.localDate, today), eq(eventOccurrences.status, "scheduled")));
      for (const o of future) {
        const hw = await ctx.tx.select({ id: homeworkTasks.id }).from(homeworkTasks).where(eq(homeworkTasks.occurrenceId, o.id)).limit(1);
        if (hw.length) {
          // keep it (and its homework) but move it to the new time on the same date if weekday unchanged
          if (cur.weekday === i.weekday) await ctx.tx.update(eventOccurrences).set({ startsAt: localToInstant(o.localDate, i.localTime, cur.timezone) }).where(eq(eventOccurrences.id, o.id));
          continue;
        }
        await cancelReminders(ctx.tx, ctx.ownerId, "occurrence", o.id);
        await ctx.tx.delete(eventOccurrences).where(eq(eventOccurrences.id, o.id));
      }
    }
    await ensureOccurrences(ctx, eid);
    await audit(ctx, "quran", "edited", "recurring_event", eid, `Updated “${i.title}”${i.paused ? " (paused)" : ""}`);
    return { id: eid, message: "Saved" };
  },
});

export const occurrenceUpdate = defineOp({
  name: "occurrence.update", module: "quran", label: "Update one class", aiAllowed: false,
  schema: z.object({
    id: zId, status: z.enum(["scheduled", "cancelled", "attended", "missed", "done"]),
    scope: z.enum(["one", "future"]).default("one"),
    reminderLeadMinutes: z.number().int().min(0).max(10080).optional().nullable(), prepNotes: zOptText(),
  }),
  summarize: (i) => `Mark ${i.scope === "future" ? "this and all future" : "this"} occurrence ${i.status}`,
  async run(ctx, i) {
    const [o] = await ctx.tx.select().from(eventOccurrences).where(and(eq(eventOccurrences.id, i.id), eq(eventOccurrences.ownerId, ctx.ownerId)));
    if (!o) throw new UserError("Not found");
    const [ev] = await ctx.tx.select().from(recurringEvents).where(eq(recurringEvents.id, o.eventId));
    await ctx.tx.update(eventOccurrences).set({
      status: i.status, reminderLeadMinutes: i.reminderLeadMinutes ?? null, prepNotes: i.prepNotes,
      completedAt: i.status === "done" || i.status === "attended" ? ctx.now : null, updatedAt: ctx.now,
    }).where(eq(eventOccurrences.id, o.id));
    if (i.scope === "future" && i.status === "cancelled") {
      // End the series the day before this occurrence; cancel later materialised occurrences.
      await ctx.tx.update(recurringEvents).set({ endDate: addDays(o.localDate, -1), updatedAt: ctx.now }).where(eq(recurringEvents.id, ev.id));
      const later = await ctx.tx.select({ id: eventOccurrences.id }).from(eventOccurrences).where(and(eq(eventOccurrences.eventId, ev.id), gte(eventOccurrences.localDate, o.localDate)));
      if (later.length) await ctx.tx.update(eventOccurrences).set({ status: "cancelled", updatedAt: ctx.now }).where(inArray(eventOccurrences.id, later.map((l) => l.id)));
    }
    await ensureOccurrences(ctx, ev.id);
    await audit(ctx, "quran", i.status, "event_occurrence", o.id, `${ev.title} on ${dmy(o.localDate)}: ${i.status}${i.scope === "future" ? " (and all future)" : ""}`);
    return { id: o.id, message: "Saved" };
  },
});

/** Next scheduled class occurrence on/after today (materialising if needed). */
export async function nextClassOccurrence(ctx: Ctx, kind: "class" | "study" = "class") {
  const evs = await ctx.tx.select().from(recurringEvents).where(and(eq(recurringEvents.ownerId, ctx.ownerId), eq(recurringEvents.kind, kind), eq(recurringEvents.paused, false)));
  for (const ev of evs) await ensureOccurrences(ctx, ev.id);
  if (!evs.length) return null;
  const [o] = await ctx.tx.select().from(eventOccurrences)
    .where(and(inArray(eventOccurrences.eventId, evs.map((e) => e.id)), gte(eventOccurrences.startsAt, ctx.now), eq(eventOccurrences.status, "scheduled")))
    .orderBy(asc(eventOccurrences.startsAt)).limit(1);
  return o ?? null;
}

export const homeworkCreate = defineOp({
  name: "homework.create", module: "quran", label: "Add homework", aiAllowed: true,
  schema: z.object({
    occurrenceId: zId.optional().nullable(), title: zText(300), description: zOptText(),
    reference: zOptText(200), dueAt: z.string().datetime({ offset: true }).optional().nullable(),
    priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  }),
  draftable: ["reference"],
  summarize: (i) => `Add Quran homework “${i.title}”${i.reference ? ` (${i.reference})` : ""} to ${i.occurrenceId ? "the selected class" : "the next class"}`,
  async run(ctx, i) {
    let occId = i.occurrenceId ?? null;
    if (occId) {
      const [o] = await ctx.tx.select({ id: eventOccurrences.id }).from(eventOccurrences).where(and(eq(eventOccurrences.id, occId), eq(eventOccurrences.ownerId, ctx.ownerId)));
      if (!o) throw new UserError("Class not found", "occurrenceId");
    } else {
      const next = await nextClassOccurrence(ctx);
      if (!next) throw new UserError("No upcoming class found — set up your class schedule first");
      occId = next.id;
    }
    const [o] = await ctx.tx.select().from(eventOccurrences).where(eq(eventOccurrences.id, occId!));
    const [h] = await ctx.tx.insert(homeworkTasks).values({
      ownerId: ctx.ownerId, occurrenceId: occId!, title: i.title, description: i.description, reference: i.reference,
      dueAt: i.dueAt ? new Date(i.dueAt) : o.startsAt, priority: i.priority ?? null, source: ctx.source,
    }).returning({ id: homeworkTasks.id });
    await audit(ctx, "quran", "created", "homework", h.id, `Homework “${i.title}” for class on ${dmy(o.localDate)}`);
    return { id: h.id, message: `Homework added for ${dmy(o.localDate)}` };
  },
});

export const homeworkUpdate = defineOp({
  name: "homework.update", module: "quran", label: "Edit homework", aiAllowed: false,
  schema: z.object({
    id: zId, title: zText(300), description: zOptText(), reference: zOptText(200),
    dueAt: z.string().datetime({ offset: true }).optional().nullable(), priority: z.enum(["low", "medium", "high"]).optional().nullable(),
    done: z.boolean(),
  }),
  summarize: (i) => `Update homework “${i.title}”`,
  async run(ctx, i) {
    const [cur] = await ctx.tx.select().from(homeworkTasks).where(and(eq(homeworkTasks.id, i.id), eq(homeworkTasks.ownerId, ctx.ownerId)));
    if (!cur) throw new UserError("Homework not found");
    await ctx.tx.update(homeworkTasks).set({
      title: i.title, description: i.description, reference: i.reference, dueAt: i.dueAt ? new Date(i.dueAt) : cur.dueAt,
      priority: i.priority ?? null, completedAt: i.done ? (cur.completedAt ?? ctx.now) : null, updatedAt: ctx.now,
    }).where(eq(homeworkTasks.id, i.id));
    const action = i.done && !cur.completedAt ? "completed" : !i.done && cur.completedAt ? "reopened" : "edited";
    await audit(ctx, "quran", action, "homework", i.id, `${action[0].toUpperCase() + action.slice(1)} homework “${i.title}”`);
    return { id: i.id, message: "Saved" };
  },
});
