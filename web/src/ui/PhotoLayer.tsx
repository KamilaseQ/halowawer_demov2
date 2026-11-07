import { useEffect, useRef, useState } from "react";
import { useStan, nav } from "../state/store";
import { DOMY, etykieta, type DomId } from "../data/domy";
import OBRYSY from "../data/obrysyZdjecia.json";
import KAM from "../data/kameraZdjecia.json";

/* Zdjęcie lotnicze z obrysami domów. Obrysy = rzut brył z GLB kamerą dopasowaną do zdjęcia
   (tools/obrysy_zdjecia.py), więc pokrywają się z 3D i przejście zdjęcie ↔ makieta jest płynne.
   Kolejność rysowania: od wschodu (A) na zachód (G); każdy dom zachodni nachodzi na sąsiada,
   więc maska wycina z obrysu części zasłonięte przez domy narysowane później. */

const ORDER: DomId[] = ["A", "B", "C", "D", "E", "F", "G"];
const POLY = OBRYSY as unknown as Record<string, [number, number][]>;
const pts = (id: string) => POLY[id].map((p) => p.join(",")).join(" ");

function useCover() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const s = Math.max(vp.w / KAM.w, vp.h / KAM.h);
  return { s, ox: (vp.w - KAM.w * s) / 2, oy: (vp.h - KAM.h * s) / 2 };
}

export function PhotoLayer() {
  const zdjecie = useStan((s) => s.zdjecie && s.widok === "osiedle" && s.tryb === "model");
  const hover = useStan((s) => s.hover);
  const gotowa = useStan((s) => s.scenaGotowa);
  const set = useStan((s) => s.set);
  const cov = useCover();
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && gotowa && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) {
      drag.current = null;
      set({ zdjecie: false, hover: null });
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  const h = hover ? POLY[hover] : null;
  let tip: { x: number; y: number } | null = null;
  if (h && zdjecie) {
    const top = h.reduce((a, b) => (b[1] < a[1] ? b : a));
    const cx = h.reduce((a, b) => a + b[0], 0) / h.length;
    tip = { x: cx * cov.s + cov.ox, y: top[1] * cov.s + cov.oy - 64 };
  }
  const dom = DOMY.find((d) => d.id === hover);

  return (
    <div className={`photo${zdjecie ? "" : " off"}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <img src={KAM.zdjecie} alt="Osiedle z lotu ptaka" draggable={false} />
      <svg viewBox={`0 0 ${KAM.w} ${KAM.h}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          {ORDER.map((id, i) => (
            <mask id={`m-${id}`} key={id} maskUnits="userSpaceOnUse" x="0" y="0" width={KAM.w} height={KAM.h}>
              <rect width={KAM.w} height={KAM.h} fill="#fff" />
              {ORDER.slice(i + 1).map((o) => (
                <polygon key={o} points={pts(o)} fill="#000" />
              ))}
            </mask>
          ))}
        </defs>
        {ORDER.map((id) => {
          const d = DOMY.find((x) => x.id === id)!;
          return (
            <polygon
              key={id}
              points={pts(id)}
              mask={`url(#m-${id})`}
              className={`obrys${d.status === "sprzedany" ? " sprzedany" : ""}${hover === id ? " hover" : ""}`}
              onPointerEnter={() => set({ hover: id })}
              onPointerLeave={() => set({ hover: null })}
              onClick={() => {
                set({ hover: null });
                nav.dom(id);
              }}
            />
          );
        })}
      </svg>
      {tip && dom && (
        <div className="lbl hover" style={{ position: "absolute", left: tip.x, top: tip.y, transform: "translate(-50%,-100%)", pointerEvents: "none" }}>
          {etykieta(dom)} <span style={{ color: "var(--ink-3)", fontWeight: 500, marginLeft: 6 }}>Zobacz w 3D →</span>
        </div>
      )}
    </div>
  );
}
