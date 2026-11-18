import { describe, it, expect } from "vitest";
import { addMonths, addDays, localToInstant, fromHijri, toHijri, nextWeekday, isoWeekday } from "@/lib/time";
import { toMinor, fromMinor, formatMoney } from "@/lib/money";
import { routineReminders, ROUTINE_TEMPLATES, routineDue, ruleDate } from "@/server/ops/care";

const tpl = (k: keyof typeof ROUTINE_TEMPLATES) => ({ id: k, reminderTime: "09:00", ...ROUTINE_TEMPLATES[k], reminderOffsetsDays: [...ROUTINE_TEMPLATES[k].reminderOffsetsDays] });
import { weeklyDates } from "@/server/ops/planning";
import { resolveDatePhrase } from "@/server/ai/dates";
import { recoveryCode, normalizeRecoveryCode, encryptField, decryptField } from "@/lib/crypto";
import { quietUntil } from "@/server/notify";

const KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("calendar-month arithmetic (PRD 4.5, 4.6, test 2, 3, 24)", () => {
  it("Jan 31 + 6 months = Jul 31", () => expect(addMonths("2026-01-31", 6)).toBe("2026-07-31"));
  it("Aug 31 + 6 months clamps to Feb 28 in a common year", () => expect(addMonths("2025-08-31", 6)).toBe("2026-02-28"));
  it("Aug 31 + 6 months clamps to Feb 29 in a leap year", () => expect(addMonths("2027-08-31", 6)).toBe("2028-02-29"));
  it("Nov 30 + 3 months = Feb 28 (toothbrush)", () => expect(addMonths("2026-11-30", 3)).toBe("2027-02-28"));
  it("Feb 29 + 12 months = Feb 28", () => expect(addMonths("2024-02-29", 12)).toBe("2025-02-28"));
  it("dental due = six calendar months", () => expect(routineDue({ ...tpl("dental"), snoozedUntil: null }, "2026-01-31")).toBe("2026-07-31"));
  it("dental reminders 14 days, 1 day and on the due date", () => {
    const r = routineReminders(tpl("dental"), "2026-01-31", "2026-07-31", "Asia/Riyadh");
    expect(r.map((x) => x.fireAt.toISOString().slice(0, 10))).toEqual(["2026-07-17", "2026-07-30", "2026-07-31"]);
    expect(r.some((x) => x.sensitive)).toBe(false);
  });
  it("toothbrush due uses first-use anchor, 3 calendar months", () => {
    expect(routineDue({ intervalValue: 3, intervalUnit: "month", snoozedUntil: null }, "2026-11-20")).toBe("2027-02-20");
  });
  it("snooze moves due date later, never earlier", () => {
    expect(routineDue({ intervalValue: 7, intervalUnit: "day", snoozedUntil: "2026-12-01" }, "2026-11-20")).toBe("2026-12-01");
    expect(routineDue({ intervalValue: 7, intervalUnit: "day", snoozedUntil: "2026-11-21" }, "2026-11-20")).toBe("2026-11-27");
  });
});

describe("waxing 40-day window (PRD 4.4, test 1)", () => {
  it("reminders on days 27/30/35/38/40 after the actual completion date, 09:00 Riyadh", () => {
    const w = { ...tpl("waxing"), snoozedUntil: null };
    const due = routineDue(w, "2026-11-01")!;
    expect(due).toBe("2026-12-01");
    const r = routineReminders(w, "2026-11-01", due, "Asia/Riyadh");
    expect(r.map((x) => x.fireAt.toISOString())).toEqual([
      "2026-11-28T06:00:00.000Z", "2026-12-01T06:00:00.000Z", "2026-12-06T06:00:00.000Z", "2026-12-09T06:00:00.000Z", "2026-12-11T06:00:00.000Z",
    ]);
    expect(r.every((x) => x.sensitive)).toBe(true);
    expect(new Set(r.map((x) => x.dedupeKey)).size).toBe(5);
    expect(r.at(-1)!.title).toBe("Waxing: last day (day 40)");
    expect(r[0].title).toBe("Waxing: due in 3 days");
  });
  it("any custom routine can nudge after the due date", () => {
    const r = routineReminders({ id: "x", name: "Haircut", reminderOffsetsDays: [2, -1, 0], reminderTime: "18:00", graceDays: null, sensitive: false }, "2026-10-01", "2026-11-01", "Asia/Riyadh");
    expect(r.map((x) => x.title)).toEqual(["Haircut: due in 1 day", "Haircut: due today", "Haircut: 2 days past due"]);
  });
});

describe("Saudi time (test 18)", () => {
  it("19:00 Riyadh is 16:00 UTC", () => expect(localToInstant("2026-11-22", "19:00").toISOString()).toBe("2026-11-22T16:00:00.000Z"));
  it("Quran class dates are Sundays", () => {
    const ds = weeklyDates({ weekday: 7, startDate: "2026-11-18", endDate: null }, "2026-11-18", 4);
    expect(ds).toEqual(["2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13"]);
    expect(ds.every((d) => isoWeekday(d) === 7)).toBe(true);
  });
  it("series end date stops recurrence", () => {
    expect(weeklyDates({ weekday: 7, startDate: "2026-11-18", endDate: "2026-11-30" }, "2026-11-18", 8)).toEqual(["2026-11-22", "2026-11-29"]);
  });
  it("nextWeekday is inclusive", () => expect(nextWeekday("2026-11-22", 7)).toBe("2026-11-22"));
});

describe("Hijri (Umm al-Qura)", () => {
  it("round-trips", () => {
    const g = fromHijri(1448, 10, 1);
    expect(toHijri(g)).toEqual({ year: 1448, month: 10, day: 1 });
  });
  it("Gregorian rule clamps Feb 29 in common years", () => {
    expect(ruleDate({ calendar: "gregorian", month: 2, day: 29 }, 2027)).toBe("2027-02-28");
  });
});

describe("money in minor units (no floats)", () => {
  it("parses decimals exactly", () => {
    expect(toMinor("0.1") + toMinor("0.2")).toBe(toMinor("0.3"));
    expect(toMinor("150.5", "SAR")).toBe(15050);
    expect(toMinor("1.234", "KWD")).toBe(1234);
  });
  it("rejects too many decimals and junk", () => {
    expect(() => toMinor("1.234", "SAR")).toThrow();
    expect(() => toMinor("12a")).toThrow();
  });
  it("formats", () => {
    expect(fromMinor(15050)).toBe("150.50");
    expect(formatMoney(1234500)).toBe("12,345 SAR");
    expect(formatMoney(-5)).toBe("-0.05 SAR");
  });
});

describe("natural dates (relative to Wed 2026-11-18)", () => {
  const T = "2026-11-18";
  it.each([
    ["today", T], ["yesterday", "2026-11-17"], ["tomorrow", "2026-11-19"],
    ["she will repay Friday", "2026-11-20"], ["next Thursday", "2026-11-19"], ["by Sunday", "2026-11-22"],
    ["last Sunday", "2026-11-15"], ["3 days ago", "2026-11-15"], ["on 25 December", "2026-12-25"], ["2027-01-05", "2027-01-05"],
  ])("%s → %s", (p, want) => expect(resolveDatePhrase(p, T)).toBe(want));
  it("no date → null", () => expect(resolveDatePhrase("I donated 100", T)).toBeNull());
});

describe("crypto", () => {
  it("recovery codes are high-entropy and normalisable", () => {
    const codes = Array.from({ length: 50 }, recoveryCode);
    expect(new Set(codes).size).toBe(50);
    expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(codes[0].toLowerCase().replace(/-/g, " "))).toBe(codes[0]);
  });
  it("AES-GCM envelope round-trips and detects tampering / wrong context", () => {
    const e = encryptField("JBSWY3DPEHPK3PXP", KEY, "totp:u1");
    expect(e).not.toContain("JBSW");
    expect(decryptField(e, KEY, "totp:u1")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptField(e, KEY, "totp:u2")).toThrow();
    const parts = e.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(() => decryptField(parts.join("."), KEY, "totp:u1")).toThrow();
  });
});

describe("quiet hours", () => {
  it("overnight window postpones to the end time", () => {
    const at = localToInstant("2026-11-18", "23:30");
    expect(quietUntil(at, "Asia/Riyadh", "22:00", "07:00")?.toISOString()).toBe(localToInstant("2026-11-19", "07:00").toISOString());
    expect(quietUntil(localToInstant("2026-11-18", "12:00"), "Asia/Riyadh", "22:00", "07:00")).toBeNull();
  });
  void addDays;
});

import { rankDocuments } from "@/server/queries";
describe("document search ranking", () => {
  const D = (title: string, kind: string, extra: Partial<{ issuer: string; notes: string; tags: string[]; idMasked: string }> = {}) =>
    ({ title, kind, issuer: extra.issuer ?? null, notes: extra.notes ?? null, tags: extra.tags ?? [], idMasked: extra.idMasked ?? null });
  const docs = [
    D("Sara passport", "passport"), D("Maryam passport", "passport"), D("Maryam degree", "certificate"),
    D("Maryam ID", "national_id", { idMasked: "••••4321" }), D("Bank letter", "letter", { issuer: "Al Rajhi" }),
  ];
  it("“maryam passport” puts the title+type match first", () => {
    const r = rankDocuments(docs, "maryam passport").map((d) => d.title);
    expect(r[0]).toBe("Maryam passport");
    expect(r).toContain("Sara passport");
    expect(r).not.toContain("Bank letter");
  });
  it("type words and synonyms match (iqama, certificate, last 4 digits, issuer)", () => {
    expect(rankDocuments(docs, "iqama").map((d) => d.title)).toEqual(["Maryam ID"]);
    expect(rankDocuments(docs, "maryam certificate")[0].title).toBe("Maryam degree");
    expect(rankDocuments(docs, "4321")[0].title).toBe("Maryam ID");
    expect(rankDocuments(docs, "rajhi")[0].title).toBe("Bank letter");
  });
});
