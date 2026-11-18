import { describe, it, expect } from "vitest";
import { detectNavigation, detectCommand, buildNavigation, buildCommand } from "@/server/ai/actions";
import { offlineProvider } from "@/server/ai/offline";
import type { AiContext } from "@/server/ai/types";

const ctx: AiContext = {
  today: "2026-11-19", weekday: "Thursday", tz: "Asia/Riyadh", currency: "SAR",
  routines: [{ alias: "r1", name: "Change bedsheets", kind: "bedsheets" }], goals: [], debts: [], projects: [], tasks: [{ alias: "t1", title: "Update portfolio website" }],
  expiries: [{ alias: "e1", label: "Passport", kind: "passport" }, { alias: "e2", label: "Ali's Passport", kind: "passport" }],
  people: [{ alias: "f1", name: "Ali", relation: "child" }],
  applications: [{ alias: "a1", university: "KAUST", program: "MSc CS", status: "preparing" }],
  subscriptions: [{ alias: "s1", name: "Netflix", status: "active" }], achievements: [], hobbies: [],
  spaces: [{ alias: "x1", name: "Reading list", section: "Me" }, { alias: "x2", name: "Groceries", section: "Home" }],
  spaceItems: [{ alias: "i1", text: "Atomic Habits", space: "Reading list", done: false }, { alias: "i2", text: "Milk", space: "Groceries", done: false }],
};
const spaceIds = { x1: "33333333-3333-4333-8333-333333333333", x2: "44444444-4444-4444-8444-444444444444" };
const ids = { f1: "11111111-1111-4111-8111-111111111111", a1: "22222222-2222-4222-8222-222222222222" };

describe("Ask AI: going to a page", () => {
  it("open Ali's passport → Documents filtered to Ali + passports", () => {
    const n = detectNavigation("open Ali's passport", ctx)!;
    expect(n).toMatchObject({ page: "documents", kind: "passport", person: "@f1" });
    const r = buildNavigation(n, ctx, ids);
    expect(r.suggestions).toEqual([{ label: "Go to Documents & IDs", detail: "Ali's passport", href: `/admin/documents?kind=passport&person=${ids.f1}` }]);
  });
  it("ambiguous: 'show the passport' when you and Ali both have one → asks whose, with options", () => {
    const n = detectNavigation("show the passport", ctx)!;
    const r = buildNavigation(n, ctx, ids, [{ personAlias: "me", kind: "passport" }, { personAlias: "@f1", kind: "passport" }]);
    expect(r.question).toBe("Whose passport?");
    expect(r.suggestions.map((s) => s.detail)).toEqual(["Your passport", "Ali's passport", "passports"]);
  });
  it("charity in 2025, an application, and bare page names", () => {
    expect(buildNavigation(detectNavigation("take me to my donations in 2025", ctx)!, ctx, ids).suggestions[0].href).toBe("/finance/charity?year=2025");
    expect(buildNavigation(detectNavigation("open my KAUST application", ctx)!, ctx, ids).suggestions[0].href).toBe(`/education/applications/${ids.a1}`);
    expect(detectNavigation("subscriptions", ctx)).toMatchObject({ page: "subscriptions" });
    expect(detectNavigation("show me when I last waxed", ctx)).toBeNull(); // a question, not navigation
    expect(detectNavigation("I donated 100 SAR today", ctx)).toBeNull();
  });
  it("links are only ever built from the catalogue", () => {
    expect(buildNavigation({ page: "https://evil.example" }, ctx, ids).suggestions).toEqual([]);
    const r = buildNavigation({ page: "history", q: "x&y=<script>" }, ctx, ids);
    expect(r.suggestions[0].href).toBe("/history?q=x%26y%3D%3Cscript%3E");
  });
});

describe("Ask AI: commands", () => {
  it("backup requests", () => {
    expect(detectCommand("save a backup of example example")).toEqual({ command: "backup.choose" });
    expect(buildCommand({ command: "backup.choose" }).options.map((o) => o.label)).toEqual(["Make a full backup", "Download a quick backup"]);
    expect(detectCommand("back up everything with my documents")).toEqual({ command: "backup.full" });
    expect(detectCommand("export my charity to excel")).toEqual({ command: "export.csv", module: "charity" });
    expect(buildCommand({ command: "export.csv", module: "charity" }).options[0].action.href).toBe("/api/export/csv?module=charity");
    expect(buildCommand({ command: "export.csv" }).options.some((o) => o.action.href.includes("period"))).toBe(false); // private section never offered unasked
  });
});

describe("Ask AI: deletes ask which one", () => {
  it("'delete the expiry reminder' → expiry delete with the record still to choose", async () => {
    const r = await offlineProvider.interpret({ text: "delete the expiry reminder", ctx });
    expect(r.operations).toEqual([{ op: "expiry.delete", input: {}, missing: ["id"] }]);
  });
  it("'remove Ali's passport expiry' → resolved directly", async () => {
    const r = await offlineProvider.interpret({ text: "remove Ali's passport expiry", ctx });
    expect(r.operations[0]).toMatchObject({ op: "expiry.delete", input: { id: "@e2" } });
  });
  it("'cancel Netflix' records the cancellation; doesn't delete", async () => {
    const r = await offlineProvider.interpret({ text: "cancel Netflix", ctx });
    expect(r.operations[0]).toMatchObject({ op: "subscription.cancel", input: { id: "@s1", cancelledOn: "2026-11-19" } });
  });
});

describe("Ask AI knows your own spaces", () => {
  it("go to a space by its name", () => {
    expect(detectNavigation("open my reading list", ctx)).toEqual({ page: "space", target: "@x1" });
    expect(detectNavigation("groceries", ctx)).toEqual({ page: "space", target: "@x2" });
    expect(buildNavigation({ page: "space", target: "@x2" }, ctx, spaceIds).suggestions).toEqual([{ label: "Go to Groceries", detail: "Home", href: `/spaces/${spaceIds.x2}` }]);
  });
  it("add, tick off and remove list items", async () => {
    expect((await offlineProvider.interpret({ text: "add Deep Work to my reading list", ctx })).operations[0]).toMatchObject({ op: "spaceItem.add", input: { spaceId: "@x1", text: "Deep Work" } });
    expect((await offlineProvider.interpret({ text: "put eggs on groceries", ctx })).operations[0]).toMatchObject({ op: "spaceItem.add", input: { spaceId: "@x2", text: "eggs" } });
    expect((await offlineProvider.interpret({ text: "tick off atomic habits", ctx })).operations[0]).toMatchObject({ op: "spaceItem.toggle", input: { id: "@i1", done: true } });
    expect((await offlineProvider.interpret({ text: "remove milk from groceries", ctx })).operations[0]).toMatchObject({ op: "spaceItem.delete", input: { id: "@i2" } });
    // not a list: still a savings deposit / other capture
    expect((await offlineProvider.interpret({ text: "add 100 SAR to savings", ctx })).operations[0]?.op).not.toBe("spaceItem.add");
  });
});
