import "server-only";
import { Resend } from "resend";

/**
 * Transactional email (initial verification, recovery verification, security alerts, optional
 * reminder fallback). Never used as a routine sign-in factor.
 * Without RESEND_API_KEY: development prints to the server console; production refuses.
 */
export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("Email is not configured (RESEND_API_KEY)");
    console.info(`\n──── DEV EMAIL (not sent) ────\nTo: ${to}\nSubject: ${subject}\n\n${text}\n──────────────────────────────\n`);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from: process.env.EMAIL_FROM ?? "Life Dashboard <onboarding@resend.dev>", to, subject, text });
  if (error) throw new Error(`Email failed: ${error.message}`);
}
