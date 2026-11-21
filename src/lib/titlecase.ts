/** Small joining words stay lower-case inside a title ("Gift Ideas for Mum"). */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** Capitalise the first letter of each word (keeps the length, so the cursor can stay where it was). */
export function titleCase(s: string): string {
  let i = 0;
  return s.replace(/\S+/g, (w) => {
    const first = i++ === 0;
    if (!first && SMALL.has(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}

/** onInput handler: title-cases the field as you type, without moving the cursor. */
export function titleCaseInput(e: React.FormEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  const v = titleCase(el.value);
  if (v === el.value) return;
  const a = el.selectionStart, b = el.selectionEnd;
  el.value = v;
  if (a !== null && b !== null) el.setSelectionRange(a, b);
}
