"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PanelClose, PlusIcon, RevealCtx } from "./OpForm";
import { Icon } from "./icons";

/**
 * A page's "add" flow: the + sits at the right end of the page title, and the form opens under the search bar
 * (or under the header), centred, only as wide as the form needs, with an X in its corner.
 * Pages with more than one kind of thing to add get a small menu from the + to pick which.
 * Wrap the header and the panels in <PageAddProvider>.
 */
const Ctx = createContext<{ open: string | null; setOpen: (v: string | null) => void } | null>(null);

export function PageAddProvider({ initialOpen, children }: { initialOpen?: string | boolean | null; children: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(initialOpen === true ? "add" : initialOpen || null);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function PageAddButton({ label, choices }: { label: string; choices?: { key: string; label: string }[] }) {
  const c = useContext(Ctx);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);
  if (!c) return null;
  const many = choices && choices.length > 1;
  const isOpen = !!c.open || menu;
  return (
    <div ref={wrap} className="relative">
      <button type="button" className="head-plus" aria-label={c.open ? "Close" : label} title={label}
        aria-expanded={isOpen} aria-haspopup={many ? "menu" : undefined} aria-controls={many ? undefined : "page-add"}
        onClick={() => {
          if (c.open) { c.setOpen(null); return; }
          if (many) setMenu(!menu); else c.setOpen(choices?.[0]?.key ?? "add");
        }}>
        <PlusIcon size={18} />
      </button>
      {menu && many && (
        <div className="pin-pop add-menu preview-enter" role="menu" aria-label={label}>
          {choices.map((ch, i) => (
            <button key={ch.key} type="button" role="menuitem" className="pin-pop-item" autoFocus={i === 0}
              onClick={() => { setMenu(false); c.setOpen(ch.key); }}>
              <PlusIcon size={14} />{ch.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageAddPanel({ title, id = "add", children }: { title: string; id?: string; children: React.ReactNode }) {
  const c = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const open = c?.open === id;
  useEffect(() => { if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [open]);
  if (!open || !c) return null;
  return (
    <div className="center-panel-wrap">
      <div ref={ref} id="page-add" className="panel center-panel panel-closable p-4 md:p-5 preview-enter" role="region" aria-label={title}>
        <PanelClose onClick={() => c.setOpen(null)} label={`Close ${title.toLowerCase()}`} />
        <p className="t-h3 mb-3 pr-10">{title}</p>
        <RevealCtx.Provider value={{ close: () => c.setOpen(null) }}>{children}</RevealCtx.Provider>
      </div>
    </div>
  );
}

/** The pencil on a page's title line: opens the page's edit panel (a <PageAddPanel id="edit">). */
export function PageEditButton({ label = "Edit" }: { label?: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  const on = c.open === "edit";
  return (
    <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={on ? "Close editing" : label} title={label}
      aria-expanded={on} aria-controls="page-add" onClick={() => c.setOpen(on ? null : "edit")}>
      <Icon name="edit" size={18} />
    </button>
  );
}

/* ───── Editing the page's own space (name, icon, section): pencil on the title line, panel under it ───── */
const EditCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function SpaceEditScope({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <EditCtx.Provider value={{ open, setOpen }}>{children}</EditCtx.Provider>;
}

export function SpaceEditButton({ label = "Edit space" }: { label?: string }) {
  const c = useContext(EditCtx);
  if (!c) return null;
  return (
    <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={c.open ? "Close editing" : label} title={label}
      aria-expanded={c.open} aria-controls="space-edit" onClick={() => c.setOpen(!c.open)}>
      <Icon name="edit" size={18} />
    </button>
  );
}

export function SpaceEditPanel({ title = "Edit space", children }: { title?: string; children: React.ReactNode }) {
  const c = useContext(EditCtx);
  if (!c?.open) return null;
  return (
    <div className="center-panel-wrap">
      <div id="space-edit" className="panel center-panel panel-closable p-4 md:p-5 preview-enter" role="region" aria-label={title}>
        <PanelClose onClick={() => c.setOpen(false)} label="Close editing" />
        <p className="t-h3 mb-3 pr-10">{title}</p>
        <RevealCtx.Provider value={{ close: () => c.setOpen(false) }}>{children}</RevealCtx.Provider>
      </div>
    </div>
  );
}
