import { ruleDate } from "@/server/ops/care";
export { todayLocal, toHijri, HIJRI_MONTHS, formatHijri } from "@/lib/time";
import { formatLocalDate } from "@/lib/time";

export function ruleDateSafe(r: { calendar: string; month: number; day: number }, year: number, today: string) {
  try {
    let d = ruleDate(r, year);
    if (d <= today) d = ruleDate(r, year + 1);
    return formatLocalDate(d);
  } catch { return "—"; }
}
