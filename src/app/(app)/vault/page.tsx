import { PageHeader } from "@/components/ui";
import { SpaceHeader } from "@/components/SpaceHeader";
import { Glyph } from "@/components/Glyph";

/** PRD 5.3 / 12.7: locked placeholder until the vault passes its security release gate. */
export default function VaultPage() {
  return (
    <>
      <SpaceHeader href="/vault" />
      <div className="panel p-6 grid gap-4 prose-w" style={{ borderColor: "var(--rust)", boxShadow: "inset 6px 0 0 var(--rust)" }}>
        <div className="flex items-center gap-3"><Glyph kind="vault" size={36} color="var(--rust)" /><p className="t-h2">Not enabled for real passwords yet</p></div>
        <p className="font-semibold">NOT APPROVED FOR REAL SECRETS</p>
        <p className="t-small text-ink-2">This area will hold passwords, PINs and recovery codes, protected by a separate vault passphrase and encrypted on your device before anything is stored. It stays locked until that design has been independently reviewed and tested, including recovery on a second device.</p>
        <p className="t-small text-ink-2">Until then, keep passwords in a dedicated password manager such as Apple Passwords or 1Password. Please don&apos;t paste passwords, PINs or codes into notes, tasks or Capture.</p>
        <p className="t-meta">Recovering your dashboard account will never unlock vault contents.</p>
      </div>
    </>
  );
}
