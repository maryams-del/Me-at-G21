import { dmy, instantToLocal } from "./time";

/** All dates display as DD/MM/YYYY. */
export const fmtDate = (d: string | null | undefined) => (d ? dmy(d) : "—");
export const fmtShort = fmtDate;

/** "Wed 18/11/2026, 19:00" in the owner's timezone. */
export function fmtDateTime(at: Date, tz: string) {
  const { date, time } = instantToLocal(at, tz);
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz }).format(at);
  return `${wd} ${dmy(date)}, ${time}`;
}

export function relDays(n: number | null) {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  const a = Math.abs(n);
  const span = a >= 365 ? `${Math.floor(a / 365)} year${a >= 730 ? "s" : ""}${Math.floor((a % 365) / 30) ? ` ${Math.floor((a % 365) / 30)} month${Math.floor((a % 365) / 30) > 1 ? "s" : ""}` : ""}` : a >= 60 ? `${Math.round(a / 30)} months` : `${a} days`;
  return n > 0 ? `in ${span}` : `${span} ago`;
}
