import { addDays } from "@/lib/time";
import type { dashboardState } from "@/server/queries";

type Dash = Awaited<ReturnType<typeof dashboardState>>;

/** Which spaces get the small "needs you" dot: something there needs the owner soon. */
export function spaceNeeds(s: Dash, attention: number): Record<string, boolean> {
  const in30 = addDays(s.today, 30);
  const nextRoutine = s.routines.filter((r) => r.due && !r.routine.paused).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
  return {
    "/admin/expiries": s.expiring.some((e) => e.expiresOn <= in30) || s.overdue.some((x) => x.href === "/admin/expiries"),
    "/inbox": attention > 0,
    "/education/applications": s.appDeadlines.length > 0,
    "/care/routines": !!nextRoutine && (nextRoutine.overdue || (nextRoutine.daysLeft ?? 99) <= 3),
    "/projects": s.tasksDueSoon.length > 0,
    "/finance/debts": s.debts.some((d) => d.overdue),
  };
}
