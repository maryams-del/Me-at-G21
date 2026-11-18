import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { periodCycles, aiProposals, achievements, projects, reminders, auditEvents } from "@/db/schema";
import { runOpInTx, getOp } from "@/server/ops";
import { interpret, searchDirect } from "@/server/ai/service";
import { offlineProvider } from "@/server/ai/offline";
import { periodState, achievementsState } from "@/server/queries";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

const at = (d: string) => localToInstant(d, "12:00");
let owner: Awaited<ReturnType<typeof makeOwner>>;
const op = (now: Date, name: string, input: unknown, source: "manual" | "ai" = "manual", who = owner.id) =>
  withCtx(who, now, (ctx) => runOpInTx(ctx.tx, { ownerId: who, tz: ctx.tz, source, now }, name, input), source);

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

describe("Period log (PRD 4.3)", () => {
  it("explicit start and end, accurate dates, no double start, no end before start", async () => {
    await op(at("2026-11-02"), "period.start", { startDate: "2026-11-02", startTime: "07:30", symptoms: ["Cramps"], notes: "heavy morning" });
    await expect(op(at("2026-11-03"), "period.start", { startDate: "2026-11-03" })).rejects.toThrow(/already open/);
    await expect(op(at("2026-11-03"), "period.end", { endDate: "2026-11-01" })).rejects.toThrow(/before the start/);
    await expect(op(at("2026-11-03"), "period.end", { endDate: "2026-11-04" })).rejects.toThrow(/future/);
    const r = await op(at("2026-11-07"), "period.end", { endDate: "2026-11-06" });
    expect(r.message).toMatch(/5 days/);
    await expect(op(at("2026-11-07"), "period.end", { endDate: "2026-11-07" })).rejects.toThrow(/no open period/);
  });

  it("notes and symptoms are encrypted at rest; audit carries no details; no reminders created", async () => {
    await op(at("2026-11-02"), "period.start", { startDate: "2026-11-02", symptoms: ["Headache"], notes: "secret-note-xyz" });
    const [row] = await getDb().select().from(periodCycles);
    expect(row.notesEnc).toBeTruthy();
    expect(row.notesEnc).not.toContain("secret-note-xyz");
    expect(row.symptomsEnc).not.toContain("Headache");
    const s = await periodState(owner, { withDetails: true });
    expect(s.cycles[0].notes).toBe("secret-note-xyz");
    expect(s.cycles[0].symptoms).toEqual(["Headache"]);
    const audits = await getDb().select().from(auditEvents).where(eq(auditEvents.category, "period"));
    expect(audits.every((a) => a.sensitive && a.summary === "Period log entry")).toBe(true);
    expect(await getDb().select().from(reminders)).toHaveLength(0);
  });

  it("past periods, overlap protection, corrections and history lengths", async () => {
    await op(at("2026-11-18"), "period.add", { startDate: "2026-08-10", endDate: "2026-08-14" });
    await op(at("2026-11-18"), "period.add", { startDate: "2026-09-07", endDate: "2026-09-11" });
    await expect(op(at("2026-11-18"), "period.add", { startDate: "2026-09-10", endDate: "2026-09-12" })).rejects.toThrow(/overlaps/);
    const c = await op(at("2026-11-18"), "period.add", { startDate: "2026-10-06", endDate: "2026-10-09" });
    await op(at("2026-11-18"), "period.update", { id: c.id, startDate: "2026-10-05", endDate: "2026-10-09" });
    const s = await periodState(owner);
    expect(s.cycles.map((x) => [x.startDate, x.length, x.cycleLength])).toEqual([
      ["2026-10-05", 5, null], ["2026-09-07", 5, 28], ["2026-08-10", 5, 28],
    ]);
    expect(s.estimate).toMatchObject({ avgCycle: 28, nextStart: "2026-11-02", avgLength: 5 });
  });

  it("is never available to the AI: ops not AI-allowed, capture and search answered locally without calling the provider", async () => {
    for (const n of ["period.start", "period.end", "period.add", "period.update", "period.delete", "period.settings"]) expect(getOp(n)!.aiAllowed).toBe(false);
    const spy = vi.spyOn(offlineProvider, "interpret");
    const r = await interpret({ id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" }, "my period started today", "text");
    expect(r.kind).toBe("search");
    expect(await getDb().select().from(aiProposals)).toHaveLength(0);
    expect(await getDb().select().from(periodCycles)).toHaveLength(0); // nothing written
    await op(at("2026-11-02"), "period.add", { startDate: "2026-10-30", endDate: "2026-11-02" });
    const a = await searchDirect({ id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" }, "When did my last period start?");
    expect(a.answer).toMatch(/30\/10\/2026/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("owner isolation", async () => {
    const other = await makeOwner("other@example.com");
    const c = await op(at("2026-11-02"), "period.add", { startDate: "2026-10-30", endDate: "2026-11-02" }, "manual", other.id);
    await expect(op(at("2026-11-03"), "period.delete", { id: c.id })).rejects.toThrow(/not found/);
    await expect(op(at("2026-11-03"), "period.update", { id: c.id, startDate: "2026-10-30" })).rejects.toThrow(/not found/);
  });
});

describe("Achievements bank (PRD 4.15)", () => {
  it("links to own projects/applications only, AI can't feature, filters and CV bullets use only stored fields", async () => {
    const other = await makeOwner("other@example.com");
    const [theirs] = await getDb().insert(projects).values({ ownerId: other.id, name: "Their project" }).returning();
    await expect(op(at("2026-11-18"), "achievement.create", { title: "X", projectId: theirs.id })).rejects.toThrow(/project not found/);
    const [mine] = await getDb().insert(projects).values({ ownerId: owner.id, name: "Portfolio site", status: "done" }).returning();

    await op(at("2026-11-18"), "achievement.create", { title: "Won the university hackathon", kind: "award", area: "academic", organisation: "KAU", endDate: "2026-03-15", skillsText: "React, teamwork", tagsText: "portfolio", projectId: mine.id, featured: true }, "ai");
    await op(at("2026-11-18"), "achievement.create", { title: "Redesigned onboarding", kind: "project", startDate: "2025-01-10", endDate: "2025-06-30", outcome: "Sign-up completion up from 41% to 63%", tagsText: "portfolio, ux", featured: true });
    const [aiRow] = await getDb().select().from(achievements).where(and(eq(achievements.ownerId, owner.id), eq(achievements.source, "ai")));
    expect(aiRow.featured).toBe(false);

    const all = await achievementsState(owner);
    expect(all.rows.map((r) => r.title)).toEqual(["Redesigned onboarding", "Won the university hackathon"]); // featured first
    expect(all.rows[0].bullet).toBe("• Redesigned onboarding: Sign-up completion up from 41% to 63% (Jan 2025 – Jun 2025)");
    expect(all.rows[1].bullet).toBe("• Won the university hackathon, KAU (Mar 2026. React, teamwork)");
    expect(all.rows[1].project?.name).toBe("Portfolio site");

    expect((await achievementsState(owner, { kind: "award" })).rows).toHaveLength(1);
    expect((await achievementsState(owner, { tag: "ux" })).rows.map((r) => r.title)).toEqual(["Redesigned onboarding"]);
    expect((await achievementsState(owner, { year: "2026" })).rows).toHaveLength(1);
    expect((await achievementsState(owner, { q: "hackathon kau" })).rows).toHaveLength(1);
  });
});
