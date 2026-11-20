import { LogoMark } from "@/components/LogoMark";

export function AuthFrame({ title, children, step }: { title: string; children: React.ReactNode; step?: { n: number; of: number; label: string } }) {
  return (
    <main className="min-h-dvh grid md:grid-cols-[1fr_1.1fr]">
      <div className="hidden md:flex relative overflow-hidden items-center justify-center gap-5" aria-hidden
        style={{ background: "linear-gradient(150deg, #2B3A2E, #1C241D)" }}>
        <div className="absolute rounded-full" style={{ left: "-10%", top: "-10%", width: "70%", aspectRatio: "1", background: "radial-gradient(closest-side, rgba(169,200,176,.35), transparent)" }} />
        <div className="absolute rounded-full" style={{ right: "-15%", bottom: "-15%", width: "70%", aspectRatio: "1", background: "radial-gradient(closest-side, rgba(214,198,166,.25), transparent)" }} />
        <svg width="120" height="120" viewBox="0 0 100 100" className="relative"><circle cx="33" cy="52" r="23" fill="#D6C6A6" /><circle cx="55" cy="52" r="23" fill="#A9C8B0" opacity=".85" /><rect x="80" y="27" width="13" height="50" rx="6.5" fill="#EEF1EA" /></svg>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mascot.png" alt="" width={110} height={146} className="relative object-contain" />
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex items-center gap-2.5 mb-8"><LogoMark size={34} /><span className="logo text-[17px]">Me @ G21</span></div>
          {step && <p className="t-meta mb-2">Step {step.n} of {step.of}: {step.label}</p>}
          <h1 className="t-h1 mb-5">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
