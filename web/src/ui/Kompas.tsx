import { useEffect, useRef } from "react";
import { rig } from "../three/CameraRig";

/* Pasek kompasu jak w inspiracjach (ui2–ui7): „· · Zach · · · Pn · ·”, środek = kierunek patrzenia. */

const MARKS: { az: number; t: string; main?: boolean }[] = [];
const NAMES: Record<number, string> = { 0: "Pn", 90: "Wsch", 180: "Pd", 270: "Zach" };
for (let a = 0; a < 360; a += 15) MARKS.push(NAMES[a] ? { az: a, t: NAMES[a], main: true } : { az: a, t: a % 45 === 0 ? "·" : "·" });

const PX_PER_DEG = 1.7;
const W = 300;

export function Kompas() {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    rig.kompas = (az: number) => {
      MARKS.forEach((m, i) => {
        const el = refs.current[i];
        if (!el) return;
        let d = m.az - az;
        d = ((d + 540) % 360) - 180;
        const x = W / 2 + d * PX_PER_DEG;
        el.style.left = `${x}px`;
        el.style.visibility = x < -20 || x > W + 20 ? "hidden" : "visible";
      });
    };
    return () => {
      rig.kompas = null;
    };
  }, []);
  return (
    <div className="kompas" aria-hidden>
      <i className="tri t" />
      <div className="tor">
        {MARKS.map((m, i) => (
          <span key={m.az} ref={(el) => { refs.current[i] = el; }} className={`k${m.main ? " main" : " dot"}`}>
            {m.t}
          </span>
        ))}
      </div>
      <i className="tri b" />
    </div>
  );
}
