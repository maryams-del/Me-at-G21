"use client";
import { startAuthentication } from "@simplewebauthn/browser";

export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) { super(message); }
}

async function raw<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.field);
  return data as T;
}

/** POST JSON. If the server asks for a fresh passkey check, run it (Face ID / Touch ID) and retry once. */
export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(path, body);
  } catch (e) {
    if (e instanceof ApiError && e.message === "step_up_required") {
      await stepUp();
      return raw<T>(path, body);
    }
    throw e;
  }
}

export async function stepUp() {
  const opts = await raw<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/stepup-options");
  const response = await startAuthentication({ optionsJSON: opts });
  await raw("/api/auth/stepup-verify", { response });
}

export function toast(message: string, tone: "ok" | "error" = "ok") {
  window.dispatchEvent(new CustomEvent("ld-toast", { detail: { message, tone } }));
}
