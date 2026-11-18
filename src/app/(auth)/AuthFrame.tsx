import { Glyph } from "@/components/Glyph";

export function AuthFrame({ title, children, step }: { title: string; children: React.ReactNode; step?: { n: number; of: number; label: string } }) {
  return (
    <main className="min-h-dvh grid md:grid-cols-[1fr_1.1fr]">
      <div className="hidden md:block relative overflow-hidden border-r-[1.5px] border-ink" style={{ background: "var(--slate)" }} aria-hidden>
        <div className="absolute" style={{ left: "12%", top: "14%", width: "44%", aspectRatio: "1", borderRadius: "50%", background: "var(--mustard)" }} />
        <div className="absolute" style={{ left: "12%", bottom: "0", width: "38%", height: "42%", background: "var(--rust)" }} />
        <div className="absolute" style={{ right: 0, bottom: 0, width: 0, height: 0, borderLeft: "34vw solid transparent", borderBottom: "34vw solid var(--paper)" }} />
        <div className="absolute" style={{ left: "50%", top: "48%", width: "34%", height: "1.5px", background: "var(--paper)" }} />
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex items-center gap-2 mb-8"><Glyph kind="home" size={30} accent="var(--mustard)" /><span className="t-h3">Life Dashboard</span></div>
          {step && <p className="t-meta mb-2">Step {step.n} of {step.of}: {step.label}</p>}
          <h1 className="t-h1 mb-5">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
