import type { Metadata } from "next";
import { KeyGenerator } from "./KeyGenerator";

export const metadata: Metadata = { title: "Generate setup keys — Me @ G21", robots: { index: false } };

/** Static helper: generates server secrets in the owner's own browser. Nothing is sent anywhere. */
export default function SetupKeysPage() {
  return (
    <main className="max-w-[760px] mx-auto px-5 py-10">
      <h1 className="t-h1">Generate your secret keys</h1>
      <p className="text-ink-2 mt-2 prose-w">These are created on this device with your browser&apos;s secure random generator. They are not sent to the app or anyone else. Copy each one into Vercel → Project <strong>me-at-g21</strong> → Settings → Environment Variables (environment: Production, type: Sensitive), then redeploy.</p>
      <p className="t-small mt-2 prose-w">Do this once. If you regenerate later, existing sign-in data (authenticator app, recovery codes) stops working.</p>
      <KeyGenerator />
    </main>
  );
}
