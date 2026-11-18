import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { reminders, mastersApplications, applicationStatusEvents, applicationRequirements, tasks } from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { interpret, confirm } from "@/server/ai/service";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

let owner: Awaited<ReturnType<typeof makeOwner>>;
const at = (d: string) => localToInstant(d, "12:00");
const op = (now: Date, name: string, input: unknown, who = () => owner.id, source: "manual" | "ai" = "manual") =>
  withCtx(who(), now, (ctx) => runOpInTx(ctx.tx, { ownerId: ctx.ownerId, tz: ctx.tz, source, now }, name, input), source);
const pending = (id: string) => getDb().select().from(reminders).where(and(eq(reminders.sourceId, id), eq(reminders.status, "scheduled")));
const base = { university: "University of Edinburgh", program: "MSc Data Science", deadlineDate: "2027-01-15", deadlineTime: "17:00", deadlineTz: "Europe/London" };

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

describe("PRD 4.13 — Master's applications", () => {
  it("stores the deadline in the university's timezone and reminds 30/14/7/1 days before", async () => {
    const a = await op(at("2026-11-18"), "application.create", { ...base, requirements: ["Transcript", "IELTS 7.0"] });
    const [row] = await getDb().select().from(mastersApplications);
    expect(row.deadlineAt!.toISOString()).toBe("2027-01-15T17:00:00.000Z"); // 17:00 London (GMT) = 20:00 Riyadh
    expect(row.deadlineVerified).toBe(false);
    const r = await pending(a.id!);
    expect(r.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2026-12-16T17:00:00.000Z", "2027-01-01T17:00:00.000Z", "2027-01-08T17:00:00.000Z", "2027-01-14T17:00:00.000Z"]);
    expect(await getDb().select().from(applicationRequirements)).toHaveLength(2);
  });

  it("status history is dated; submitting stops deadline reminders and records the submission date", async () => {
    const a = await op(at("2026-11-18"), "application.create", base);
    await op(at("2026-11-20"), "application.status", { id: a.id, status: "preparing", onDate: "2026-11-20" });
    await op(at("2026-12-01"), "application.status", { id: a.id, status: "submitted", onDate: "2026-12-01", note: "Paid fee" });
    expect(await pending(a.id!)).toHaveLength(0);
    const ev = await getDb().select().from(applicationStatusEvents).where(eq(applicationStatusEvents.applicationId, a.id!));
    expect(ev.map((e) => e.toStatus).sort()).toEqual(["preparing", "researching", "submitted"]);
    const [row] = await getDb().select().from(mastersApplications);
    expect(row.submittedOn).toBe("2026-12-01");
    await expect(op(at("2026-12-01"), "application.status", { id: a.id, status: "submitted", onDate: "2026-12-01" })).rejects.toThrow(/Already/);
  });

  it("allows several programs at the same university and owner-checked follow-ups/links", async () => {
    await op(at("2026-11-18"), "application.create", base);
    const b = await op(at("2026-11-18"), "application.create", { ...base, program: "MSc AI", linksText: "Program page | https://example.ac.uk/ai\nhttps://example.ac.uk/fees" });
    expect(await getDb().select().from(mastersApplications)).toHaveLength(2);
    const [rowB] = await getDb().select().from(mastersApplications).where(eq(mastersApplications.id, b.id!));
    expect(rowB.links).toEqual([{ label: "Program page", url: "https://example.ac.uk/ai" }, { label: "example.ac.uk", url: "https://example.ac.uk/fees" }]);
    await expect(op(at("2026-11-18"), "application.create", { ...base, linksText: "not a link" })).rejects.toThrow(/Not a valid link/);
    await op(at("2026-11-18"), "task.create", { title: "Email supervisor", applicationId: b.id, dueOn: "2026-11-25" });
    expect((await getDb().select().from(tasks))[0].applicationId).toBe(b.id);
    const other = await makeOwner("other@example.com");
    await expect(op(at("2026-11-18"), "task.create", { title: "x", applicationId: b.id }, () => other.id)).rejects.toThrow(/Application not found/);
    await expect(op(at("2026-11-18"), "application.status", { id: b.id, status: "submitted", onDate: "2026-11-18" }, () => other.id)).rejects.toThrow(/not found/);
  });

  it("AI never verifies a deadline and asks rather than guessing one", async () => {
    const owner2 = { id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" };
    const res = await interpret(owner2, "I want to apply to University of Edinburgh for MSc Data Science", "text");
    if (res.kind !== "proposal") throw new Error("expected proposal");
    const opp = res.proposal.operations[0];
    expect(opp.op).toBe("application.create");
    expect(opp.input.deadlineDate ?? null).toBeNull(); // nothing invented
    expect(res.proposal.questions.join(" ")).toMatch(/won't guess/);
    // Even if an AI proposal claims "verified", the saved record is unverified.
    const made = await op(at("2026-11-18"), "application.create", { ...base, deadlineVerified: true }, () => owner.id, "ai");
    const [row] = await getDb().select().from(mastersApplications).where(eq(mastersApplications.id, made.id!));
    expect(row.deadlineVerified).toBe(false);
  });

  it("Capture can mark an existing application submitted", async () => {
    await op(at("2026-11-18"), "application.create", base);
    const o2 = { id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" };
    const res = await interpret(o2, "I submitted my application to University of Edinburgh today", "text");
    if (res.kind !== "proposal") throw new Error("expected proposal");
    expect(res.proposal.operations[0]).toMatchObject({ op: "application.status", valid: true });
    await confirm({ id: owner.id, timezone: "Asia/Riyadh" }, res.proposal.id, res.proposal.version, [{ position: 0, mode: "apply" }]);
    const [row] = await getDb().select().from(mastersApplications);
    expect(row.status).toBe("submitted");
  });
});
