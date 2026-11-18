/** Money is integer minor units. Currencies listed here have 2 decimals unless noted. */
const DECIMALS: Record<string, number> = { SAR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, KWD: 3, BHD: 3, OMR: 3, JPY: 0 };
export const CURRENCIES = Object.keys(DECIMALS);
export const decimalsFor = (c: string) => DECIMALS[c.toUpperCase()] ?? 2;

/** Parse a user-entered decimal string into minor units without floating point. */
export function toMinor(input: string | number, currency = "SAR"): number {
  const s = String(input).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${input}`);
  const d = decimalsFor(currency);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  if (frac.length > d) throw new Error(`Too many decimal places for ${currency}`);
  const minor = BigInt(whole) * 10n ** BigInt(d) + BigInt((frac + "0".repeat(d)).slice(0, d) || "0");
  const n = Number(neg ? -minor : minor);
  if (!Number.isSafeInteger(n)) throw new Error("Amount too large");
  return n;
}

export function fromMinor(minor: number, currency = "SAR"): string {
  const d = decimalsFor(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(d);
  const whole = (abs / base).toString();
  const frac = d ? "." + (abs % base).toString().padStart(d, "0") : "";
  return (neg ? "-" : "") + whole + frac;
}

export function formatMoney(minor: number, currency = "SAR"): string {
  const [w, f] = fromMinor(minor, currency).split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = f && /^0+$/.test(f) ? "" : f ? "." + f : "";
  return `${grouped}${trimmed} ${currency}`;
}
