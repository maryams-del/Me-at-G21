import { readFileSync, existsSync } from "node:fs";
import type { Page, BrowserContext } from "@playwright/test";

export function lastEmailCode(to: string, after = 0): string {
  if (!existsSync("/tmp/ld-e2e-outbox.jsonl")) throw new Error("no outbox");
  const lines = readFileSync("/tmp/ld-e2e-outbox.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to === to && m.at >= after && /one-time code is \d{6}/.test(m.text));
  const m = lines.at(-1)?.text.match(/one-time code is (\d{6})/);
  if (!m) throw new Error("no code email");
  return m[1];
}

/** A CDP virtual authenticator = a phone/laptop with a platform passkey and user verification (Face ID / Touch ID). */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}
