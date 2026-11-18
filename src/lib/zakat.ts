/**
 * Zakat estimate arithmetic. Pure and integer-only (minor units, basis points), shared by the
 * live calculator in the browser and the server that saves the snapshot, so both always agree.
 * This is an estimate tool, not a religious ruling: what counts, the nisab basis and the rate
 * are all owner choices.
 */
import { toMinor } from "./money";

export const NISAB_GRAMS = { gold: 85, silver: 595 } as const;
export type NisabBasis = "gold" | "silver" | "manual";

export type ZakatLine = { label: string; amount: string };
export type ZakatInput = {
  currency: string;
  assets: ZakatLine[];
  liabilities: ZakatLine[];
  nisabBasis: NisabBasis;
  /** price of one gram in `currency`, as typed (decimal string); required for gold/silver */
  pricePerGram?: string | null;
  /** grams for the chosen metal; defaults 85 g gold / 595 g silver, editable */
  nisabGrams?: string | null;
  /** used when nisabBasis is "manual" */
  manualNisab?: string | null;
  /** percent as typed, e.g. "2.5" */
  ratePercent: string;
};

export type ZakatResult = {
  assetsMinor: number; liabilitiesMinor: number; netMinor: number;
  nisabMinor: number; aboveNisab: boolean; rateBp: number; zakatMinor: number;
  steps: string[];
};

/** "2.5" → 250 basis points (up to 2 decimals). */
export function percentToBp(p: string): number {
  const s = p.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) throw new Error("Rate must be a percent like 2.5");
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

/** grams (decimal string, up to 3 dp) × price-per-gram minor units, rounded half up. */
function gramsTimesPrice(grams: string, priceMinor: number): number {
  const s = grams.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error("Grams must be a number like 85");
  const [w, f = ""] = s.split(".");
  const milli = BigInt(w) * 1000n + BigInt((f + "000").slice(0, 3));
  const v = (milli * BigInt(priceMinor) + 500n) / 1000n;
  return Number(v);
}

export function computeZakat(i: ZakatInput, fmt: (minor: number) => string = String): ZakatResult {
  const sum = (ls: ZakatLine[]) => ls.filter((l) => l.amount.trim()).reduce((a, l) => a + toMinor(l.amount, i.currency), 0);
  const assetsMinor = sum(i.assets);
  const liabilitiesMinor = sum(i.liabilities);
  const netMinor = Math.max(0, assetsMinor - liabilitiesMinor);
  let nisabMinor: number;
  const steps: string[] = [];
  steps.push(`Assets you counted: ${fmt(assetsMinor)}`);
  steps.push(`Minus deductions/liabilities: ${fmt(liabilitiesMinor)}`);
  steps.push(`Net zakatable wealth: ${fmt(netMinor)}`);
  if (i.nisabBasis === "manual") {
    if (!i.manualNisab?.trim()) throw new Error("Enter the nisab amount");
    nisabMinor = toMinor(i.manualNisab, i.currency);
    steps.push(`Nisab (entered by you): ${fmt(nisabMinor)}`);
  } else {
    if (!i.pricePerGram?.trim()) throw new Error(`Enter today's ${i.nisabBasis} price per gram`);
    const price = toMinor(i.pricePerGram, i.currency);
    const grams = i.nisabGrams?.trim() || String(NISAB_GRAMS[i.nisabBasis]);
    nisabMinor = gramsTimesPrice(grams, price);
    steps.push(`Nisab (${grams} g ${i.nisabBasis} × ${fmt(price)}/g): ${fmt(nisabMinor)}`);
  }
  const aboveNisab = netMinor >= nisabMinor && netMinor > 0;
  const rateBp = percentToBp(i.ratePercent);
  const zakatMinor = aboveNisab ? Number((BigInt(netMinor) * BigInt(rateBp) + 5000n) / 10000n) : 0;
  steps.push(aboveNisab
    ? `Net is at or above nisab, so ${i.ratePercent}% of ${fmt(netMinor)} = ${fmt(zakatMinor)}`
    : `Net is below nisab, so the estimate is ${fmt(0)}`);
  return { assetsMinor, liabilitiesMinor, netMinor, nisabMinor, aboveNisab, rateBp, zakatMinor, steps };
}
