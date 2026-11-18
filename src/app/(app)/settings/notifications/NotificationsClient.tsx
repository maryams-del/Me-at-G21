"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { Section } from "@/components/ui";

type Prefs = { pushEnabled: boolean; emailFallback: boolean; showSensitivePreviews: boolean; quietStart: string | null; quietEnd: string | null };
type Env = { ios: boolean; standalone: boolean; pushApi: boolean; permission: NotificationPermission | "unsupported"; subscribed: boolean };

function b64ToUint8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationsClient({ vapidKey, prefs: initial, devices, scheduler, emailConfigured }: {
  vapidKey: string; prefs: Prefs; devices: { id: string; device: string | null; lastSuccessAt: string | null; failedAt: string | null; createdAt: string }[];
  scheduler: { at: string; ok: boolean } | null; emailConfigured: boolean;
}) {
  const router = useRouter();
  const [env, setEnv] = useState<Env | null>(null);
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function detect() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const pushApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    let subscribed = false;
    if (pushApi) {
      const reg = await navigator.serviceWorker.getRegistration();
      subscribed = !!(await reg?.pushManager.getSubscription());
    }
    setEnv({ ios, standalone, pushApi, permission: "Notification" in window ? Notification.permission : "unsupported", subscribed });
  }
  useEffect(() => { detect(); }, []);

  async function enable() {
    setBusy(true); setErr(null);
    try {
      if (!vapidKey) throw new Error("Push isn't configured on the server yet (VAPID keys missing).");
      const perm = await Notification.requestPermission(); // must be inside this tap handler on iOS
      if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked. Allow them in Settings → Notifications (iPhone) or your browser's site settings." : "Permission wasn't granted.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(vapidKey) }));
      await api("/api/push/subscribe", sub.toJSON());
      toast("Reminders enabled on this device");
      await detect(); router.refresh();
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  }
  async function disableHere() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    toast("Push turned off on this device"); await detect(); router.refresh();
  }

  const canSubscribe = env && env.pushApi && (!env.ios || env.standalone);
  const fmt = (s: string | null) => {
  if (!s) return "never";
  const t = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()}, ${p(t.getHours())}:${p(t.getMinutes())}`;
};

  return (
    <div>
      <Section title="This device">
        <div className="panel p-4 grid gap-3">
          {!env ? <p className="t-meta">Checking…</p> : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 t-small">
                <dt className="text-ink-3">Installed as app</dt><dd>{env.standalone ? "Yes" : "No"}</dd>
                <dt className="text-ink-3">Notification permission</dt><dd>{env.permission === "unsupported" ? "Not supported here" : env.permission === "default" ? "Not asked yet" : env.permission}</dd>
                <dt className="text-ink-3">Push on this device</dt><dd>{env.subscribed ? "Subscribed" : "Not subscribed"}</dd>
              </dl>
              {env.ios && !env.standalone && (
                <div className="panel p-3" style={{ background: "var(--tint-mustard)" }}>
                  <p className="t-h3">On iPhone, install the app first</p>
                  <ol className="list-decimal pl-5 t-small mt-1 grid gap-1">
                    <li>In Safari, tap the Share button.</li>
                    <li>Choose <strong>Add to Home Screen</strong>, then Add.</li>
                    <li>Open Life from your Home Screen and come back to this page.</li>
                    <li>Tap <strong>Enable reminders</strong> and allow notifications.</li>
                  </ol>
                  <p className="t-meta mt-2">iPhone only delivers web notifications to apps added to the Home Screen (iOS 16.4 or later). A Safari tab won&apos;t receive them.</p>
                </div>
              )}
              {!env.pushApi && !env.ios && <p className="t-small">This browser doesn&apos;t support push notifications. Reminders will still appear in the app{emailConfigured ? ", and email fallback is available below" : ""}.</p>}
              <div className="flex flex-wrap gap-2">
                {canSubscribe && !env.subscribed && <button className="btn btn-primary" onClick={enable} disabled={busy}>{busy ? "Enabling…" : "Enable reminders"}</button>}
                {env.subscribed && <button className="btn" onClick={async () => { setTestResult(null); try { const r = await api<{ message: string }>("/api/push/test"); setTestResult(r.message); } catch (e) { setTestResult((e as Error).message); } }}>Send a test notification</button>}
                {env.subscribed && <button className="btn btn-ghost" onClick={disableHere}>Turn off on this device</button>}
              </div>
              {testResult && <p className="t-small" role="status">{testResult}</p>}
              {err && <p className="error" role="alert">{err}</p>}
            </>
          )}
        </div>
      </Section>

      <Section title="Devices receiving push">
        {devices.length ? (
          <ul className="list panel px-4">{devices.map((d) => (
            <li key={d.id} className="py-2 t-small flex flex-wrap justify-between gap-2"><span>{d.device ?? "Device"}</span><span className="t-meta">Added {fmt(d.createdAt)}. Last delivered {fmt(d.lastSuccessAt)}{d.failedAt ? `. Last failure ${fmt(d.failedAt)}` : ""}</span></li>
          ))}</ul>
        ) : <p className="t-meta">None yet.</p>}
        <p className="t-meta mt-2">“Delivered” means the push service accepted the message. Your phone&apos;s Focus or notification settings can still hide it.</p>
      </Section>

      <Section title="Preferences">
        <form className="panel p-4 grid gap-3" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          try { await api("/api/push/prefs", prefs); toast("Preferences saved"); router.refresh(); } catch (x) { setErr(x instanceof ApiError ? x.message : "Couldn't save"); }
        }}>
          <label className="check"><input type="checkbox" checked={prefs.pushEnabled} onChange={(e) => setPrefs({ ...prefs, pushEnabled: e.target.checked })} />Send push notifications to subscribed devices</label>
          <label className="check"><input type="checkbox" checked={prefs.emailFallback} disabled={!emailConfigured} onChange={(e) => setPrefs({ ...prefs, emailFallback: e.target.checked })} />Email me a reminder when no push was delivered{!emailConfigured && " (email isn't configured on the server)"}</label>
          <label className="check"><input type="checkbox" checked={prefs.showSensitivePreviews} onChange={(e) => setPrefs({ ...prefs, showSensitivePreviews: e.target.checked })} />Show personal-care details on the lock screen (off = “Personal reminder”)</label>
          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
            <label className="field"><span className="label">Quiet hours from</span><input type="time" className="input" value={prefs.quietStart ?? ""} onChange={(e) => setPrefs({ ...prefs, quietStart: e.target.value || null })} /></label>
            <label className="field"><span className="label">until</span><input type="time" className="input" value={prefs.quietEnd ?? ""} onChange={(e) => setPrefs({ ...prefs, quietEnd: e.target.value || null })} /></label>
          </div>
          <p className="t-meta">During quiet hours reminders wait and are sent when quiet hours end.</p>
          <div><button className="btn btn-primary">Save preferences</button></div>
        </form>
      </Section>

      <Section title="Reminder scheduler">
        <p className="t-small">{scheduler ? `Last run ${fmt(scheduler.at)}${scheduler.ok ? "" : " (failed)"}.` : "The scheduler hasn't run yet, so push and email reminders won't be sent. See the README to connect one."}</p>
      </Section>
    </div>
  );
}
