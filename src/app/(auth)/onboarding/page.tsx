import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/core";
import { OnboardingClient } from "./OnboardingClient";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const s = await getSession();
  if (s && s.method !== "onboarding" && s.user.onboardingStep === "complete") redirect("/");
  return <OnboardingClient step={s ? s.user.onboardingStep : "email"} email={s?.user.email ?? ""} />;
}
