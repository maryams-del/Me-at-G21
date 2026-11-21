import { missingConfig } from "@/lib/config";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/core";
import { AuthFrame } from "../AuthFrame";
import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (missingConfig().length) redirect("/setup");
  const s = await getSession();
  if (s) redirect(s.method === "onboarding" || s.user.onboardingStep !== "complete" ? "/onboarding" : "/");
  return (
    <AuthFrame title="Sign in">
      <LoginClient />
    </AuthFrame>
  );
}
