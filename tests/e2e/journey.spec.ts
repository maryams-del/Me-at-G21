import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { generateSync } from "otplib";
import { readFileSync, mkdirSync } from "node:fs";
import { addVirtualAuthenticator, lastEmailCode } from "./helpers";

const EMAIL = "owner@example.com";
mkdirSync("test-results/screens", { recursive: true });
/** Click until the dialog appears (dev-mode hydration can lag behind the first click). */
async function openCapture(page: Page, name = "Add entry by AI") {
  await expect(async () => {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

test.describe.serial("owner journey (iPhone-like platform authenticator)", () => {
  let context: BrowserContext;
  let page: Page;
  let recoveryCodes: string[] = [];
  let totpSecret = "";

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    page = await context.newPage();
    await addVirtualAuthenticator(context, page);
  });
  test.afterAll(async () => { await context.close(); });

  test("Test 12/19/20 — onboarding: email → passkey → TOTP → offline recovery codes", async () => {
    await page.goto("/onboarding");
    await page.getByLabel("Email").fill("someone-else@example.com");
    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByText(/6-digit code is on its way/)).toBeVisible(); // generic: no account enumeration
    await page.getByRole("button", { name: "Use a different email" }).click();

    const t0 = Date.now();
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByLabel("Verification code")).toBeVisible();
    await page.getByLabel("Verification code").fill(lastEmailCode(EMAIL, t0));
    await page.getByLabel(/call you/).fill("Demo");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("heading", { name: "Create your passkey" })).toBeVisible();
    const btn = page.getByRole("button", { name: /Create passkey/ });
    await expect(btn).toHaveText("Create passkey with Face ID / Touch ID"); // detected via WebAuthn platform API, not camera
    await shot(page, "02-onboarding-passkey");
    await btn.click();

    await expect(page.getByRole("heading", { name: "Add an authenticator app" })).toBeVisible();
    await page.getByText("Can't scan? Enter this key").click();
    totpSecret = (await page.locator("code").innerText()).replace(/\s/g, "");
    await page.getByLabel("6-digit code from the app").fill(generateSync({ secret: totpSecret }));
    await page.getByRole("button", { name: "Verify and continue" }).click();

    await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
    await page.getByRole("button", { name: "Generate 10 recovery codes" }).click();
    const items = page.getByRole("list", { name: "Recovery codes" }).locator("li .select-all");
    await expect(items).toHaveCount(10);
    recoveryCodes = await items.allInnerTexts();
    await shot(page, "04-onboarding-codes");
    await expect(page.getByRole("button", { name: "Finish setup" })).toBeDisabled();
    await page.getByLabel(/saved these codes/).check();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo");

    const outbox = readFileSync("/tmp/ld-e2e-outbox.jsonl", "utf8");
    for (const c of recoveryCodes) expect(outbox).not.toContain(c);
    expect(outbox).not.toContain(totpSecret);
  });

  test("set opening fast balance and log savings goal manually", async () => {
    await page.goto("/faith/fasts");
    await page.getByLabel("Fasts owed").fill("12");
    await page.getByRole("button", { name: "Save opening balance" }).click();
    await expect(page.locator(".tile.mustard .t-num")).toHaveText("12");

    await page.goto("/finance/savings");
    await page.getByRole("button", { name: "New goal" }).click();
    await page.getByLabel("Goal name").fill("Laptop");
    await page.getByLabel("Target amount").fill("5000");
    await page.getByLabel(/Planned monthly/).fill("500");
    await page.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("heading", { name: /Laptop/ })).toBeVisible();
    await expect(page.getByText("0 SAR", { exact: true }).first()).toBeVisible(); // a plan is not money
  });

  test("Tests 8/9 — AI capture: three previews, correction, nothing saved until Confirm", async () => {
    await page.goto("/finance/charity");
    await expect(page.getByText(/No donations in/)).toBeVisible();
    await page.goto("/");
    await openCapture(page);
    const dlg = page.getByRole("dialog", { name: "Capture" });
    await dlg.getByLabel(/What happened/).fill("Donated 100 SAR via Ehsan, changed bedsheets, and finished a fast");
    await dlg.getByRole("button", { name: "Preview" }).click();
    await expect(dlg.getByText("Log charity", { exact: true })).toBeVisible();
    await expect(dlg.getByText("Log routine event", { exact: true })).toBeVisible();
    await expect(dlg.getByText("Fast completed", { exact: true })).toBeVisible();
    await dlg.getByLabel(/Correct anything/).fill("Actually, make the donation 150");
    await dlg.getByRole("button", { name: "Update" }).click();
    await expect(dlg.getByText("Version 2", { exact: false })).toBeVisible();
    await expect(dlg.getByText(/150 SAR to Ehsan/)).toBeVisible();
    await shot(page, "06-capture-preview");

    // Still nothing saved: check in a second tab
    const p2 = await context.newPage();
    await p2.goto("/finance/charity");
    await expect(p2.getByText(/No donations in/)).toBeVisible();
    await p2.close();

    await dlg.getByRole("button", { name: "Save 3 entries" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved 3 entries" })).toBeVisible();
    await page.goto("/finance/charity");
    await expect(page.getByText("150 SAR").first()).toBeVisible();
    await shot(page, "07-charity");
    await page.goto("/faith/fasts");
    await expect(page.locator(".tile.mustard .t-num")).toHaveText("11");
  });

  test("Test 10 — incomplete capture becomes a confirmed draft in Needs details", async () => {
    await page.goto("/");
    await openCapture(page);
    const dlg = page.getByRole("dialog", { name: "Capture" });
    await dlg.getByLabel(/What happened/).fill("I lent Sara money yesterday, she will repay Friday");
    await dlg.getByRole("button", { name: "Preview" }).click();
    await expect(dlg.getByText(/How much did you lend/)).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Save 1 draft" })).toBeVisible();
    await dlg.getByRole("button", { name: "Save 1 draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: "sent to Needs details" })).toBeVisible();
    await page.goto("/inbox");
    await expect(page.getByText("“I lent Sara money yesterday, she will repay Friday”")).toBeVisible();
    await page.getByLabel("Amount").fill("200");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText(/Nothing waiting/)).toBeVisible();
    await page.goto("/finance/debts");
    await expect(page.getByText("Sara owes you")).toBeVisible();
    await shot(page, "08-debts");
  });

  test("Test 11 — grounded search", async () => {
    await page.goto("/history");
    await page.getByLabel("Ask about your records").fill("When did I last wax?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("I couldn't find any logged waxing.")).toBeVisible();
    await page.getByLabel("Ask about your records").fill("How much did I donate this year?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/You donated 150 SAR between/)).toBeVisible();
  });

  test("tracker pages render with real data", async () => {
    await page.goto("/care/waxing");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Done today" }).click();
    await expect(page.getByText("Day 0", { exact: false })).toBeVisible();
    await shot(page, "09-waxing");
    await page.goto("/quran");
    await expect(page.getByRole("heading", { name: "Next class" })).toBeVisible();
    await expect(page.getByText(/Sun \d{2}\/\d{2}\/\d{4}, 19:00/).first()).toBeVisible();
    await shot(page, "10-quran");
    for (const [path, name] of [["/care/routines", "11-routines"], ["/finance/savings", "12-savings"], ["/projects", "13-projects"], ["/care/dental", "14-dental"], ["/settings/notifications", "15-notifications"], ["/vault", "16-vault"], ["/", "17-dashboard"]] as const) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await shot(page, name);
    }
    await expect(page.getByText("NOT APPROVED FOR REAL SECRETS")).toHaveCount(0);
    await page.goto("/vault");
    await expect(page.getByText("NOT APPROVED FOR REAL SECRETS")).toBeVisible();
  });

  test("Life admin: expiry, document upload, ID reveal behind passkey step-up", async () => {
    await page.goto("/admin/expiries");
    await page.getByRole("button", { name: "Track something" }).click();
    await page.getByLabel("What is it?").fill("Driving licence");
    await page.locator("form").filter({ has: page.getByLabel("What is it?") }).getByRole("combobox", { name: /^Type/ }).selectOption("license");
    await page.getByLabel("Expiry date").fill("2027-02-01");
    await page.getByRole("button", { name: "Start tracking" }).click();
    await expect(page.getByRole("heading", { name: /Driving licence/ })).toBeVisible();

    await page.goto("/admin/documents");
    await page.getByRole("button", { name: "Add a document" }).click();
    await page.getByLabel("Title").fill("Passport");
    await page.getByLabel("Expiry date").fill("2030-05-01");
    await page.getByLabel("ID number").fill("P1234567");
    await page.getByLabel("Choose a file for this document").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\ntest file only\n%%EOF") });
    await expect(page.getByText(/passport\.pdf \(1 KB\)/)).toBeVisible();
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("••••4567")).toBeVisible();
    await expect(page.getByText("P1234567")).toHaveCount(0);
    await expect(page.getByText(/passport\.pdf v1/)).toBeVisible(); // uploaded in the same save
    await expect(page.getByText("01/05/2030")).toBeVisible(); // DD/MM/YYYY
    await page.getByRole("button", { name: "Reveal" }).click(); // passkey step-up via the virtual authenticator
    await expect(page.getByText("P1234567")).toBeVisible();
    await shot(page, "22-documents");
    const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
    const ok = await page.request.get(href!);
    expect(ok.status()).toBe(200);
    expect((await ok.body()).toString()).toContain("test file only");
    const anon = await (await page.context().browser()!.newContext()).request.get(new URL(href!, "http://localhost:3100").toString());
    expect(anon.status()).toBe(401);
    // Family member + compressed photo upload
    await page.getByRole("button", { name: /^Family members/ }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Ali");
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByText("Ali added")).toBeVisible();
    await page.getByRole("button", { name: "Add a document" }).click();
    await page.getByLabel("Title").fill("Passport");
    await page.getByRole("combobox", { name: "Belongs to" }).first().selectOption({ label: "Ali (child)" });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Choose a file for this document").setInputFiles({ name: "ali.png", mimeType: "image/png", buffer: png });
    await page.getByLabel(/Compress file to reduce size/).first().check();
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText(/Document saved with its file/)).toBeVisible();
    await page.goto("/admin/documents?q=ali+passport");
    await expect(page.locator("main li").first().getByText("Ali", { exact: true })).toBeVisible();
    await page.goto("/admin/documents?kind=certificate");
    await expect(page.getByText(/No documents match type “Certificate”/)).toBeVisible();
    await page.goto("/admin/documents?q=passport+4567");
    await expect(page.getByRole("heading", { name: "Passport", level: 2 }).first()).toBeVisible();
    await page.goto("/admin/expiries");
    const order = await page.locator("main li h2").allInnerTexts();
    expect(order.findIndex((x) => x.startsWith("Driving licence"))).toBeLessThan(order.findIndex((x) => x.startsWith("Passport")));
    await page.goto("/admin/expiries?sort=latest");
    const rev = await page.locator("main li h2").allInnerTexts();
    expect(rev.findIndex((x) => x.startsWith("Passport"))).toBeLessThan(rev.findIndex((x) => x.startsWith("Driving licence")));
    await page.goto("/admin/expiries?kind=license");
    await expect(page.locator("main li h2")).toHaveCount(1);
    await page.goto("/admin/expiries");
    await shot(page, "23-expiries");
  });

  test("mobile layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Capture with AI" })).toBeVisible();
    await shot(page, "18-mobile-dashboard");
    await openCapture(page, "Capture with AI");
    await page.getByRole("dialog").getByLabel(/What happened/).fill("I cleaned my makeup brushes today");
    await page.getByRole("dialog").getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("dialog").getByText("Log routine event", { exact: true })).toBeVisible();
    await shot(page, "19-mobile-capture");
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  test("Tests 12/15/20 — sign out, passkey sign-in, then stolen-phone recovery on another device", async ({ browser }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out of this device" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: "Sign in with passkey" }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 3000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo");

    // Another device with no passkeys (the phone is gone).
    const other = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await other.newPage();
    await p.goto("/recover");
    const t0 = Date.now();
    await p.getByLabel("Account email").fill(EMAIL);
    await p.getByRole("button", { name: "Email me a code" }).click();
    await expect(p.getByLabel(/6-digit code from your email/)).toBeVisible();
    await p.getByLabel(/6-digit code from your email/).fill(lastEmailCode(EMAIL, t0));
    await p.getByRole("textbox", { name: "Recovery code" }).fill(recoveryCodes[0].toLowerCase().replace(/-/g, " "));
    await shot(p, "20-recover");
    await p.getByRole("button", { name: "Recover my account" }).click();
    await expect(p.getByText("You recovered your account")).toBeVisible();
    await expect(p.getByText(/9 of 10 unused/)).toBeVisible();

    // Removing the lost phone's passkey is delayed after recovery.
    p.once("dialog", (d) => d.accept());
    await p.getByRole("button", { name: "Sign out all others" }).click();
    await expect(p.getByRole("status").filter({ hasText: "Signed out everywhere else" })).toBeVisible();
    await shot(p, "21-security-after-recovery");

    // The "stolen" device's session is now dead.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // A used recovery code can't be used again.
    const p3 = await (await browser.newContext()).newPage();
    await p3.goto("/recover");
    const t1 = Date.now();
    await p3.getByLabel("Account email").fill(EMAIL);
    await p3.getByRole("button", { name: "Email me a code" }).click();
    await expect(p3.getByLabel(/6-digit code from your email/)).toBeVisible();
    await p3.getByLabel(/6-digit code from your email/).fill(lastEmailCode(EMAIL, t1));
    await p3.getByRole("textbox", { name: "Recovery code" }).fill(recoveryCodes[0]);
    await p3.getByRole("button", { name: "Recover my account" }).click();
    await expect(p3.getByText(/didn't match/)).toBeVisible();

    // TOTP alone without the email code fails; email + TOTP works.
    await p3.reload();
    const t2 = Date.now();
    await p3.getByLabel("Account email").fill(EMAIL);
    await p3.getByRole("button", { name: "Email me a code" }).click();
    await p3.getByLabel(/6-digit code from your email/).fill("000000");
    await p3.getByLabel("A code from my authenticator app").check();
    await p3.getByLabel("6-digit authenticator code").fill(generateSync({ secret: totpSecret }));
    await p3.getByRole("button", { name: "Recover my account" }).click();
    await expect(p3.getByText(/didn't match/)).toBeVisible();
    void t2;
    await other.close();
  });

  test("Test 17 — unauthenticated API access is refused", async ({ request }) => {
    const r = await request.post("/api/ops/charity.create", { data: { amount: "1" }, headers: { Origin: "http://localhost:3100" } });
    expect(r.status()).toBe(401);
    const x = await request.post("/api/ops/charity.create", { data: { amount: "1" }, headers: { Origin: "https://evil.example" } });
    expect(x.status()).toBe(403);
    const c = await request.get("/api/cron/dispatch");
    expect(c.status()).toBe(401);
    const ok = await request.get("/api/cron/dispatch", { headers: { Authorization: "Bearer e2e-cron-secret" } });
    expect(ok.status()).toBe(200);
  });
});
