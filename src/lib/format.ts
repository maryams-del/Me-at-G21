import { formatLocalDate } from "./time";
export const fmtDate = (d: string | null | undefined) => (d ? formatLocalDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtShort = (d: string | null | undefined) => (d ? formatLocalDate(d, { day: "numeric", month: "short" }) : "—");
export function fmtDateTime(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(at);
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
