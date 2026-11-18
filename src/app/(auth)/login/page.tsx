import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/core";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { AuthFrame } from "../AuthFrame";
import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.method === "onboarding" || s.user.onboardingStep !== "complete" ? "/onboarding" : "/");
  const [u] = await getDb().select({ step: users.onboardingStep }).from(users).limit(1);
  return (
    <AuthFrame title="Sign in">
      <LoginClient setupAvailable={!u || u.step !== "complete"} />
    </AuthFrame>
  );
}
