import { missingConfig } from "@/lib/config";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/core";
import { OnboardingClient } from "./OnboardingClient";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  if (missingConfig().length) redirect("/setup");
  const s = await getSession();
  if (!invite && s && s.method !== "onboarding" && s.user.onboardingStep === "complete") redirect("/");
  return <OnboardingClient step={invite ? "email" : s ? s.user.onboardingStep : "email"} email={invite ? "" : s?.user.email ?? ""} invite={invite?.slice(0, 400)} />;
}
