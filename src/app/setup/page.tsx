import Link from "next/link";
import { redirect } from "next/navigation";
import { missingConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const missing = missingConfig();
  if (!missing.length) redirect("/login");
  return (
    <main className="max-w-[720px] mx-auto px-5 py-10">
      <h1 className="t-h1">Me @ G21 isn&apos;t set up yet</h1>
      <p className="text-ink-2 mt-2 prose-w">Add these settings in your Vercel project, then redeploy (Vercel → Deployments → ⋯ → Redeploy). This page only lists names, never values.</p>
      <ul className="list panel px-4 mt-6">
        {missing.map((m) => (
          <li key={m.key} className="py-3 grid gap-1">
            <code className="font-medium">{m.key}</code>
            <span className="t-small text-ink-2">{m.how}</span>
          </li>
        ))}
      </ul>
      <Link href="/setup-keys" className="btn btn-primary mt-6">Generate secret keys</Link>
    </main>
  );
}
