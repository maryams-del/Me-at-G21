"use client";
import { titleCase, sentenceCase, titleCaseInput, sentenceCaseInput } from "@/lib/titlecase";
import { Dropdown } from "@/components/GlyphSelect";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { computeZakat, NISAB_GRAMS, type NisabBasis, type ZakatLine } from "@/lib/zakat";
import { formatMoney, CURRENCIES } from "@/lib/money";

const ASSET_SUGGESTIONS = ["Cash at home", "Bank accounts", "Savings", "Gold & silver (value you hold)", "Shares / investments (zakatable part)", "Money owed to you (expected back)", "Business stock"];
const LIAB_SUGGESTIONS = ["Debts due now", "Bills due before the evaluation date"];

function Lines({ title, lines, set, suggestions, currency }: { title: string; lines: ZakatLine[]; set: (l: ZakatLine[]) => void; suggestions: string[]; currency: string }) {
  const listId = `${title.replace(/\W/g, "")}-sugg`;
  return (
    <fieldset className="grid gap-2">
      <legend className="t-h3 mb-2">{title}</legend>
      <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      {lines.map((l, n) => (
        <div key={n} className="grid grid-cols-[1fr_9rem_auto] gap-2 items-center">
          <input className="input" list={listId} aria-label={`${title} ${n + 1} description`} value={l.label} placeholder="Description" autoCapitalize="words" onChange={(e) => set(lines.map((x, i) => i === n ? { ...x, label: titleCase(e.target.value) } : x))} />
          <input className="input text-right" inputMode="decimal" aria-label={`${title} ${n + 1} amount (${currency})`} value={l.amount} placeholder="0" onChange={(e) => set(lines.map((x, i) => i === n ? { ...x, amount: e.target.value.replace(/[^\d.,]/g, "") } : x))} />
          <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove ${title.toLowerCase()} line ${n + 1}`} onClick={() => set(lines.filter((_, i) => i !== n))}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm justify-self-start" onClick={() => set([...lines, { label: "", amount: "" }])}>+ Add line</button>
    </fieldset>
  );
}

export function ZakatCalculator({ today, currency: defCurrency }: { today: string; currency: string }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(defCurrency);
  const [assets, setAssets] = useState<ZakatLine[]>([{ label: "Bank accounts", amount: "" }, { label: "Cash at home", amount: "" }, { label: "Savings", amount: "" }]);
  const [liabilities, setLiabilities] = useState<ZakatLine[]>([{ label: "Debts due now", amount: "" }]);
  const [basis, setBasis] = useState<NisabBasis>("silver");
  const [price, setPrice] = useState("");
  const [grams, setGrams] = useState("");
  const [manual, setManual] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [rate, setRate] = useState("2.5");
  const [date, setDate] = useState(today);
  const [remind, setRemind] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const clean = (ls: ZakatLine[]) => ls.map((l) => ({ ...l, amount: l.amount.replace(/,/g, "") }));
  const result = useMemo(() => {
    try {
      return { ok: true as const, r: computeZakat({ currency, assets: clean(assets), liabilities: clean(liabilities), nisabBasis: basis, pricePerGram: price, nisabGrams: grams, manualNisab: manual, ratePercent: rate }, (m) => formatMoney(m, currency)) };
    } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  }, [currency, assets, liabilities, basis, price, grams, manual, rate]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ message?: string }>("/api/ops/zakat.calculate", {
        evaluationDate: date, currency, assets: clean(assets), liabilities: clean(liabilities), nisabBasis: basis,
        pricePerGram: price || null, nisabGrams: grams || null, manualNisab: manual || null, priceSource: priceSource || null,
        ratePercent: rate, remindNextYear: remind, notes: notes || null,
      });
      toast(r.message ?? "Saved");
      router.refresh();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save. Nothing was changed.", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-start">
      <div className="panel p-5 grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field"><span className="label">Evaluation date</span><input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field" role="group"><span className="label">Currency</span><Dropdown ariaLabel="Currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></div>
        </div>
        <Lines title="Assets you count" lines={assets} set={setAssets} suggestions={ASSET_SUGGESTIONS} currency={currency} />
        <Lines title="Deductions" lines={liabilities} set={setLiabilities} suggestions={LIAB_SUGGESTIONS} currency={currency} />
        <fieldset className="grid gap-3">
          <legend className="t-h3 mb-2">Nisab</legend>
          <div className="flex flex-wrap gap-4">
            {(["silver", "gold", "manual"] as const).map((b) => (
              <label key={b} className="check"><input type="radio" name="basis" checked={basis === b} onChange={() => setBasis(b)} /><span>{b === "manual" ? "Enter amount myself" : `${b[0].toUpperCase()}${b.slice(1)} (${NISAB_GRAMS[b]} g)`}</span></label>
            ))}
          </div>
          {basis === "manual" ? (
            <label className="field"><span className="label">Nisab amount ({currency})</span><input className="input" inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} /></label>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field"><span className="label">{basis === "gold" ? "Gold" : "Silver"} price per gram ({currency})</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Today's price" /></label>
              <label className="field"><span className="label">Grams <span className="t-meta">(optional)</span></span><input className="input" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder={String(NISAB_GRAMS[basis])} /></label>
              <label className="field sm:col-span-2"><span className="label">Where the price is from <span className="t-meta">(optional)</span></span><input className="input" value={priceSource} autoCapitalize="words" onChange={(e) => setPriceSource(titleCase(e.target.value))} placeholder="e.g. local jeweller, 18/11/2026" /></label>
              <p className="t-meta sm:col-span-2">Prices are entered by you; the app does not fetch live prices.</p>
            </div>
          )}
          <label className="field max-w-[12rem]"><span className="label">Rate (%)</span><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        </fieldset>
        <label className="field"><span className="label">Notes <span className="t-meta">(optional)</span></span><textarea className="textarea" value={notes} autoCapitalize="sentences" onChange={(e) => setNotes(sentenceCase(e.target.value))} /></label>
        <label className="check"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /><span>Remind me one lunar year after this date</span></label>
      </div>

      <aside className="panel p-5 grid gap-4 lg:sticky lg:top-6" aria-live="polite">
        <p className="t-small text-ink-2">Estimate</p>
        {result.ok ? (
          <>
            <p className="t-num text-[2rem] md:text-[2.6rem] leading-tight">{formatMoney(result.r.zakatMinor, currency)}</p>
            <ol className="grid gap-1.5 t-small list-decimal pl-5">{result.r.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </>
        ) : <p className="t-small">{result.error}</p>}
        <p className="t-meta">An estimate from the figures you entered, not a religious ruling. What counts as zakatable, the nisab basis and the lunar-year rules vary by circumstance and school; check with a scholar you trust when unsure. Saving this does not record a payment.</p>
        <button type="button" className="btn btn-primary justify-self-start" disabled={busy || !result.ok} onClick={save}>{busy ? "Saving…" : "Save estimate"}</button>
      </aside>
    </div>
  );
}
