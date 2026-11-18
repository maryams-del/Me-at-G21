/**
 * Offline interpreter: a deterministic, rule-based parser used when no AI key is configured
 * (AI_PROVIDER=offline) and in tests. Nothing leaves the server. It covers the common phrasings
 * from the PRD; anything it can't understand becomes a clarifying question, never a guess.
 */
import type { AiProvider, AiContext, Interpretation, ProposedOp, SearchQuery } from "./types";
import { resolveDatePhrase } from "./dates";
import { addDays } from "@/lib/time";

const NUM_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5 };
const CUR: Record<string, string> = { sar: "SAR", riyal: "SAR", riyals: "SAR", rial: "SAR", rials: "SAR", sr: "SAR", "﷼": "SAR", usd: "USD", dollars: "USD", dollar: "USD", $: "USD", aed: "AED", dirham: "AED", dirhams: "AED", eur: "EUR", euro: "EUR", euros: "EUR", gbp: "GBP", pounds: "GBP", pkr: "PKR", rupee: "PKR", rupees: "PKR", rs: "PKR" };

function amountOf(s: string): { amount: string; currency: string | null } | null {
  const m = s.match(/(\$|\brs\.?\s?|\bpkr\s?)?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(sar|riyals?|rials?|sr|usd|dollars?|aed|dirhams?|eur|euros?|gbp|pounds|pkr|rupees?|rs)?\b/i);
  if (!m) return null;
  const cur = m[1] ? (m[1].trim() === "$" ? "USD" : "PKR") : m[4] ? CUR[m[4].toLowerCase()] : null;
  return { amount: m[2].replace(/,/g, "") + (m[3] ?? ""), currency: cur };
}

const cap = (s: string) => s.trim().replace(/^./, (c) => c.toUpperCase());
const stripDates = (s: string) => s.replace(/\b(today|yesterday|tomorrow|tonight|this (morning|evening)|on \w+day|next \w+day|last \w+day|by \w+day|\d{4}-\d{2}-\d{2})\b/gi, "").replace(/\s{2,}/g, " ").trim().replace(/[.,;]+$/, "");

function findByName<T extends { alias: string }>(items: T[], text: string, key: (t: T) => string): T | null {
  const t = text.toLowerCase();
  return items.find((i) => t.includes(key(i).toLowerCase())) ?? null;
}

function splitClauses(text: string): string[] {
  return text
    .split(/(?:,|;|\band then\b|\bthen\b|\balso\b|\band\b(?=\s+(?:i|i've|i have|we|changed|cleaned|finished|completed|did|donated|lent|borrowed|saved|got|bought|started|waxed|paid|add)\b))/i)
    .map((c) => c.trim()).filter(Boolean);
}

function parseSearch(text: string, ctx: AiContext): SearchQuery | null {
  const t = text.toLowerCase().trim();
  const isQuestion = /\?$/.test(t) || /^(when|how much|how many|what|which|did i|have i|show|find|search|list|who)\b/.test(t);
  if (!isQuestion) return null;
  if (/last|most recent|latest/.test(t)) {
    if (/wax/.test(t)) return { type: "last_event", target: "waxing" };
    if (/dental|scaling|teeth/.test(t)) return { type: "last_event", target: "dental" };
    if (/fast/.test(t)) return { type: "last_event", target: "fasts" };
    if (/donat|charity/.test(t)) return { type: "last_event", target: "charity" };
    const r = findByName(ctx.routines, t, (x) => x.kind) ?? (/sheet/.test(t) ? ctx.routines.find((x) => x.kind === "bedsheets") : /toothbrush/.test(t) ? ctx.routines.find((x) => x.kind === "toothbrush") : /brush/.test(t) ? ctx.routines.find((x) => x.kind === "brushes") : null);
    if (r) return { type: "last_event", target: `routine:${r.alias}` };
  }
  if (/how much.*(donat|charity|give|gave)/.test(t)) {
    const year = t.match(/\b(20\d{2})\b/)?.[1];
    if (/this month/.test(t)) return { type: "charity_total", from: ctx.today.slice(0, 8) + "01", to: ctx.today };
    if (/last month/.test(t)) {
      const first = addDays(ctx.today.slice(0, 8) + "01", -1).slice(0, 8) + "01";
      return { type: "charity_total", from: first, to: addDays(ctx.today.slice(0, 8) + "01", -1) };
    }
    if (year) return { type: "charity_total", from: `${year}-01-01`, to: `${year}-12-31` };
    return { type: "charity_total", from: ctx.today.slice(0, 4) + "-01-01", to: ctx.today };
  }
  if (/fast/.test(t) && /(how many|balance|left|remaining|owe)/.test(t)) return { type: "fast_balance" };
  if (/(owe|owes|lent|borrowed|outstanding)/.test(t)) return { type: "debts_outstanding", direction: /owes me|lent/.test(t) ? "lent" : /i owe|borrowed/.test(t) ? "borrowed" : undefined };
  if (/saving|goal/.test(t)) return { type: "savings_status", goal: findByName(ctx.goals, t, (g) => g.name)?.alias };
  if (/class|quran/.test(t) && /next|when/.test(t)) return { type: "next_class" };
  return { type: "text", q: t.replace(/^(when|what|did i|have i|show|find|search|list)\s+/, "").replace(/\?$/, "").slice(0, 100) };
}

function parseClause(c: string, ctx: AiContext, ops: ProposedOp[], questions: string[]) {
  const t = c.toLowerCase();
  const date = resolveDatePhrase(t, ctx.today);
  const onDate = date ?? ctx.today;
  const assumedDate = date ? [] : ["date"];

  // Follow-up clause for a debt: "she will repay Friday"
  if (/(repay|pay (me |her |him )?back|return it|give it back|due)/.test(t) && !/\b(lent|borrowed)\b/.test(t) && !amountOf(t.replace(/\b\d{4}-\d{2}-\d{2}\b/, ""))) {
    const last = [...ops].reverse().find((o) => o.op === "debt.create");
    if (last) {
      if (date) { last.input.dueDate = date; last.missing = (last.missing ?? []).filter((f) => f !== "dueDate"); }
      return;
    }
  }

  if (/\b(donat|sadaqah|sadaqa|charity|zakat al-fitr)/.test(t) || /\bgave\b.*\b(to|for)\b/.test(t)) {
    const a = amountOf(t);
    const recipient = c.match(/\b(?:through|via|on|using|to)\s+(?:the\s+)?([A-Za-z0-9][\w'&.-]*(?:\s+[A-Z][\w'&.-]*)*)/)?.[1];
    const cause = c.match(/\bfor\s+(?:the\s+)?(.+?)(?:\s+(?:today|yesterday|on\s+\w+|this\s+\w+))?\s*$/i)?.[1];
    const missing: string[] = [];
    if (!a) missing.push("amount");
    if (!recipient) missing.push("recipient");
    ops.push({
      op: "charity.create",
      input: {
        paidOn: onDate, recipient: recipient ? cap(recipient) : undefined, cause: cause ? stripDates(cause) : null,
        amount: a?.amount, currency: a?.currency ?? ctx.currency,
        status: /\b(plan|will|going to|want to|intend)\b/.test(t) ? "planned" : "completed",
      },
      missing, assumed: [...assumedDate, ...(a && !a.currency ? ["currency"] : [])],
    });
    if (!recipient) questions.push("Which platform or recipient was the donation to?");
    if (!a) questions.push("How much did you donate?");
    return;
  }

  let m: RegExpMatchArray | null;
  if ((m = c.match(/\b(?:i\s+)?lent\s+(?:(\w+)\s+)?(.*)/i)) && /\blent\b/i.test(c) && !/lent me/i.test(c)) {
    const a = amountOf(t);
    let who = m[1] && !/^\d/.test(m[1]) ? m[1] : c.match(/\bto\s+([A-Z][\w-]*)/)?.[1];
    if (who && /^(some|money|him|her|them)$/i.test(who)) who = c.match(/\bto\s+([A-Z][\w-]*)/)?.[1];
    pushDebt("lent", who, a);
    return;
  }
  if ((m = c.match(/\bborrowed\b.*?\bfrom\s+([A-Z][\w-]*)/i)) || (m = c.match(/\b([A-Z][\w-]*)\s+lent me\b/i))) {
    pushDebt("borrowed", m[1], amountOf(t));
    return;
  }
  function pushDebt(direction: "lent" | "borrowed", who: string | undefined, a: ReturnType<typeof amountOf>) {
    const due = c.match(/(?:repay|pay (?:me |her |him )?back|due|return)\s+(.*)$/i)?.[1];
    const dueDate = due ? resolveDatePhrase(due, ctx.today) : null;
    const before = due ? c.slice(0, c.toLowerCase().indexOf(due.toLowerCase())) : c;
    const txDate = resolveDatePhrase(before, ctx.today);
    const missing: string[] = [];
    if (!a) missing.push("amount");
    if (!who) missing.push("counterparty");
    ops.push({
      op: "debt.create",
      input: { direction, counterparty: who ? cap(who) : undefined, amount: a?.amount, currency: a?.currency ?? ctx.currency, onDate: txDate ?? ctx.today, dueDate: dueDate ?? null, reminderOffsetsDays: [-1, 0] },
      missing, assumed: txDate ? [] : ["onDate"],
    });
    if (!a) questions.push(`How much did you ${direction === "lent" ? "lend" : "borrow"}?`);
  }

  if (/\bfasts?\b/.test(t) && /(complet|finish|did|made up|make up|fasted|kept|observed)/.test(t)) {
    const n = Number(t.match(/\b(\d+)\s+(?:make-?up\s+)?fasts?\b/)?.[1] ?? NUM_WORDS[t.match(/\b(one|a|an|two|three|four|five)\s+(?:make-?up\s+)?fasts?\b/)?.[1] ?? "one"] ?? 1);
    if (n > 1) {
      questions.push(`Each fast is logged on its own date. Which ${n} dates did you fast?`);
      for (let k = 0; k < n; k++) ops.push({ op: "fasts.complete", input: { onDate: undefined }, missing: ["onDate"] });
    } else {
      ops.push({ op: "fasts.complete", input: { onDate }, assumed: assumedDate });
    }
    return;
  }
  const routineFor = (kind: string) => ctx.routines.find((r) => r.kind === kind);
  if (/(bed ?sheets?|sheets|bedding)/.test(t)) return routineOp(routineFor("bedsheets"), "completed", "bedsheets");
  if (/toothbrush/.test(t)) return routineOp(routineFor("toothbrush"), /\b(bought|purchased|got a new)\b/.test(t) && !/(start|using|use|opened)/.test(t) ? "purchased" : "first_use", "toothbrush");
  if (/brush/.test(t) && /(clean|wash)/.test(t)) return routineOp(routineFor("brushes"), "completed", "brushes");
  function routineOp(r: { alias: string; name: string } | undefined, type: string, kind?: string) {
    if (!r && kind) { ops.push({ op: "routine.done", input: { kind, type, onDate }, assumed: assumedDate }); return; }
    const named = r ?? findByName(ctx.routines, t, (x) => x.name);
    ops.push({ op: "routine.log", input: { routineId: named ? `@${named.alias}` : undefined, type, onDate }, missing: named ? [] : ["routineId"], assumed: assumedDate });
    if (!named) questions.push("Which routine is this for?");
  }
  if (/\bwax/.test(t)) { ops.push({ op: "waxing.complete", input: { completedOn: onDate }, assumed: assumedDate }); return; }
  if (/(dental|scaling|teeth clean|cleaning at the dentist)/.test(t)) { ops.push({ op: "dental.complete", input: { completedOn: onDate }, assumed: assumedDate }); return; }

  if (/(saved|save|deposit|put|added|add)\b/.test(t) && /(saving|goal|fund|towards|toward)/.test(t)) {
    const a = amountOf(t);
    const g = findByName(ctx.goals, t, (x) => x.name);
    ops.push({ op: "savings.deposit", input: { goalId: g ? `@${g.alias}` : undefined, amount: a?.amount, onDate }, missing: [...(g ? [] : ["goalId"]), ...(a ? [] : ["amount"])], assumed: assumedDate });
    if (!g) questions.push(ctx.goals.length ? `Which goal: ${ctx.goals.map((x) => x.name).join(", ")}?` : "You don't have a savings goal yet — create one first in Finance → Savings.");
    return;
  }
  if (/(withdr[ae]w|took .* out of)/.test(t) && /(saving|goal|fund)/.test(t)) {
    const a = amountOf(t);
    const g = findByName(ctx.goals, t, (x) => x.name);
    ops.push({ op: "savings.withdraw", input: { goalId: g ? `@${g.alias}` : undefined, amount: a?.amount, onDate }, missing: [...(g ? [] : ["goalId"]), ...(a ? [] : ["amount"])] });
    return;
  }

  if (/(homework|memori[sz]e|revise|revision|learn the translation|tafsir)/.test(t)) {
    const body = c.replace(/^.*?(homework\s*:?\s*)/i, "").trim() || c;
    const ref = c.match(/\b((?:surah|surat|sura)\s+[\w'-]+(?:\s*[,:]?\s*(?:ayah|ayat|verses?)\s*[\d\s,–-]+)?|(?:ayah|ayat|verses?)\s+[\d\s,–-]+)/i)?.[1]?.trim();
    const title = cap(stripDates(body.replace(/\bby\s+(the\s+)?(next\s+)?(class|sunday)\b/i, "")).replace(/^i have quran\s*/i, ""));
    ops.push({ op: "homework.create", input: { title: title || "Quran homework", reference: ref ?? null }, missing: ref ? [] : ["reference"] });
    if (!ref && /(verse|ayah|surah|translation)/.test(t)) questions.push("Which surah/verses? You can add them later.");
    return;
  }

  if ((m = c.match(/\b(?:new|create|start(?:ed)?)\s+(?:a\s+)?project\s*:?\s*(?:called\s+)?(.+)/i))) {
    ops.push({ op: "project.create", input: { name: cap(stripDates(m[1]).replace(/^["“]|["”]$/g, "")), targetDate: date } });
    return;
  }
  if ((m = c.match(/\b(?:add (?:a )?task|remind me to|todo|to-do|i need to|i have to|task)\s*:?\s*(.+)/i))) {
    const p = findByName(ctx.projects, t, (x) => x.name);
    const time = c.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    let dueTime: string | null = null;
    if (time) {
      let h = Number(time[1]);
      if (time[3]?.toLowerCase() === "pm" && h < 12) h += 12;
      if (time[3]?.toLowerCase() === "am" && h === 12) h = 0;
      dueTime = `${String(h).padStart(2, "0")}:${time[2] ?? "00"}`;
    }
    const title = cap(stripDates(m[1].replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/i, "").replace(/\bfor (my )?project\b.*$/i, "")));
    ops.push({ op: "task.create", input: { title, projectId: p ? `@${p.alias}` : null, dueOn: date, dueTime }, missing: date ? [] : ["dueOn"] });
    return;
  }

  if (/\b(appl(y|ying|ied|ication)|master'?s|msc|ma\b|mba|admission)/.test(t) && !/\bexpir/.test(t)) {
    const app = ctx.applications.find((x) => t.includes(x.university.toLowerCase()) || t.includes(x.university.toLowerCase().replace(/^university of /, "")));
    const st = /\b(submitted|sent|applied)\b/.test(t) ? "submitted" : /\binterview/.test(t) ? "interview" : /\baccepted|admitted|got in\b/.test(t) ? "accepted" : /\brejected|declined\b/.test(t) ? "rejected" : /\bwithdr/.test(t) ? "withdrawn" : null;
    if (app && st) {
      ops.push({ op: "application.status", input: { id: `@${app.alias}`, status: st, onDate }, assumed: assumedDate });
      return;
    }
    const uni = c.match(/\b(?:to|at)\s+((?:the\s+)?(?:university of\s+)?[A-Z][\w'&.-]*(?:\s+(?:of\s+)?[A-Z][\w'&.-]*)*)/)?.[1];
    const prog = c.match(/\bfor\s+(?:an?\s+|the\s+)?((?:MSc|MA|MBA|MEng|LLM|Master'?s|MPhil)[^,.;]*?)(?=\s+(?:at|to|deadline|due|by)\b|[,.;]|$)/i)?.[1];
    const dl = c.match(/\b(?:deadline|due|by)\b(.*)$/i)?.[1];
    const deadline = dl ? resolveDatePhrase(dl, ctx.today) : null;
    if (uni || prog) {
      const missing = [...(uni ? [] : ["university"]), ...(prog ? [] : ["program"]), ...(deadline ? [] : ["deadlineDate"])];
      ops.push({ op: "application.create", input: { university: uni?.trim(), program: prog?.trim(), deadlineDate: deadline, deadlineTz: deadline ? ctx.tz : null, status: "researching", requirements: [], links: [], documentIds: [] }, missing });
      if (!deadline) questions.push(`What's the deadline${uni ? ` for ${uni.trim()}` : ""}? Please copy it from the official site; I won't guess it.`);
      if (!prog) questions.push("Which program is it?");
      return;
    }
  }
  const EXP_KINDS: [RegExp, string, string][] = [
    [/passport/, "passport", "Passport"], [/(national id|iqama|\bid card\b|residence permit)/, "national_id", "National ID"],
    [/(driving licen[cs]e|driver'?s licen[cs]e|licen[cs]e)/, "license", "Driving licence"], [/(bank card|credit card|debit card|\bcard\b)/, "bank_card", "Bank card"],
    [/(membership)/, "membership", "Membership"],
  ];
  const expKind = EXP_KINDS.find(([re]) => re.test(t));
  if (/\brenew(ed|al)?\b/.test(t) && expKind) {
    const hit = ctx.expiries.find((e) => e.kind === expKind[1]) ?? findByName(ctx.expiries, t, (e) => e.label);
    const after = t.split(/(?:until|till|new expiry(?: date)?(?: is)?|now expires|expires(?: on)?|valid (?:until|till))/)[1];
    const newDate = after ? resolveDatePhrase(after, ctx.today) : null;
    const missing = [...(hit ? [] : ["itemId"]), ...(newDate ? [] : ["newExpiresOn"])];
    ops.push({ op: "expiry.renew", input: { itemId: hit ? `@${hit.alias}` : undefined, renewedOn: ctx.today, newExpiresOn: newDate ?? undefined }, missing, assumed: ["renewedOn"] });
    if (!hit) questions.push(`I couldn't find a tracked ${expKind[2].toLowerCase()} — add it first, then record the renewal.`);
    if (!newDate) questions.push("What's the new expiry date?");
    return;
  }
  if (expKind || /\bexpir/.test(t)) {
    const who = ctx.people.find((f) => { const n = f.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); return !!n && new RegExp(`(^|[^\\p{L}])${n}('s|s)?(?![\\p{L}])`, "u").test(t); });
    const kind = expKind?.[1] ?? "custom";
    const label = expKind?.[2] ?? cap(stripDates(c.replace(/^(add|track|remind me( about)?|my)\s+/i, "").replace(/\b(expiry|expires?|expiring|expiration)\b.*$/i, "")).trim() || "Item");
    const date = resolveDatePhrase(t.replace(/^.*?\b(expir\w*|valid until|until|on)\b/, ""), ctx.today) ?? resolveDatePhrase(t, ctx.today);
    ops.push({ op: "expiry.create", input: { label, kind, personId: who ? `@${who.alias}` : null, expiresOn: date ?? undefined, reminderOffsetsDays: [-90, -30, -7] }, missing: date ? [] : ["expiresOn"] });
    if (!date) questions.push(`When does ${who ? `${who.name}'s` : "your"} ${label.toLowerCase()} expire? You can also save it now and fill in the date later.`);
    return;
  }
  if (/(document|subscription|zakat|period|application|achievement)/.test(t)) {
    questions.push("That module isn't available in Capture yet (documents are added from Life admin → Documents). I've left it unsaved.");
    return;
  }
  if (c.length > 2) questions.push(`I couldn't match “${c}” to a tracker. Could you rephrase it, or use a form?`);
}

/** Apply a natural-language correction to an existing set of ops. Returns null if not a correction. */
function applyCorrection(text: string, prev: ProposedOp[], ctx: AiContext): ProposedOp[] | null {
  const t = text.toLowerCase().trim();
  const looksLikeCorrection = /^(no|nope|actually|make (it|that|the)|change|instead|correction|wait|sorry|not\b|it was|it's|remove|drop|don'?t|skip)/.test(t);
  if (!looksLikeCorrection) return null;
  const ops: ProposedOp[] = structuredClone(prev);
  const moduleOf: Record<string, RegExp> = {
    "charity.create": /donat|charity|gift/, "debt.create": /lend|lent|borrow|loan|debt/, "fasts.complete": /fast/,
    "routine.log": /sheet|brush|toothbrush|routine/, "routine.done": /sheet|brush|toothbrush|routine/, "waxing.complete": /wax/, "dental.complete": /dental|scaling/,
    "savings.deposit": /saving|deposit/, "expiry.create": /passport|expir|licen|iqama|card|membership/, "expiry.renew": /renew/, "task.create": /task/, "homework.create": /homework/,
  };
  const target = (pred: (o: ProposedOp) => boolean) => {
    const byWord = ops.filter((o) => moduleOf[o.op]?.test(t) && pred(o));
    return byWord.length ? byWord : ops.filter(pred);
  };
  if (/^(remove|drop|don'?t|skip|forget)/.test(t)) {
    const victims = ops.filter((o) => moduleOf[o.op]?.test(t));
    return victims.length ? ops.filter((o) => !victims.includes(o)) : ops;
  }
  let changed = false;
  const a = amountOf(t.replace(/\b\d{4}-\d{2}-\d{2}\b/, ""));
  if (a && !/(day|days|week)/.test(t)) {
    const hits = target((o) => "amount" in o.input);
    const o = hits[hits.length - 1];
    if (o) {
      o.input.amount = a.amount;
      if (a.currency) o.input.currency = a.currency;
      o.missing = (o.missing ?? []).filter((f) => f !== "amount");
      changed = true;
    }
  }
  const date = resolveDatePhrase(t, ctx.today);
  if (date) {
    const dateKeys = ["paidOn", "onDate", "completedOn", "dueOn", "dueDate", "expiresOn", "newExpiresOn"];
    const wantsDue = /\b(due|repay|pay back|deadline|by)\b/.test(t);
    const hits = target((o) => dateKeys.some((k) => k in o.input));
    for (const o of hits.slice(-1)) {
      const key = wantsDue && ("dueDate" in o.input || "dueOn" in o.input) ? ("dueDate" in o.input ? "dueDate" : "dueOn") : dateKeys.find((k) => k in o.input)!;
      o.input[key] = date;
      o.missing = (o.missing ?? []).filter((f) => f !== key);
      o.assumed = (o.assumed ?? []).filter((f) => f !== "date" && f !== key);
      changed = true;
    }
  }
  const to = text.match(/\b(?:to|recipient is|platform is|through|via)\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*)*)\s*$/);
  if (to) {
    const o = ops.find((x) => x.op === "charity.create");
    if (o) { o.input.recipient = to[1]; o.missing = (o.missing ?? []).filter((f) => f !== "recipient"); changed = true; }
  }
  return changed ? ops : null;
}

export const offlineProvider: AiProvider = {
  name: "offline",
  async interpret({ text, ctx, previous }) {
    const prevOps = previous?.at(-1)?.operations;
    if (prevOps?.length) {
      const corrected = applyCorrection(text, prevOps, ctx);
      if (corrected) return { intent: "capture", operations: corrected, questions: [] };
    }
    const search = !prevOps?.length ? parseSearch(text, ctx) : null;
    if (search) return { intent: "search", operations: [], questions: [], query: search };
    const ops: ProposedOp[] = prevOps ? structuredClone(prevOps) : [];
    const questions: string[] = [];
    for (const c of splitClauses(text)) parseClause(c, ctx, ops, questions);
    if (!ops.length && !questions.length) questions.push("I couldn't find anything to log. Try “I donated 100 SAR via Ehsan today”.");
    return { intent: ops.length ? "capture" : "unsupported", operations: ops, questions: [...new Set(questions)] };
  },
};
