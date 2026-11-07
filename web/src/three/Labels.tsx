import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useStan, nav } from "../state/store";
import { DOMY, etykieta, type DomId } from "../data/domy";
import { reg } from "./models";

/* Etykiety domów: warstwa DOM nad canvasem, pozycje liczone w useFrame (rzut kotwicy nad kalenicą),
   z rozsuwaniem kolizji: pigułka, która nachodzi na bliższą, idzie w górę i dostaje cienką linię do dachu. */

type Slot = { el: HTMLDivElement | null; line: HTMLDivElement | null; anchor: THREE.Vector3 | null };
export const labelSlots = new Map<DomId, Slot>();
const v = new THREE.Vector3();

export function HouseLabelProjector() {
  const { camera, size } = useThree();
  const last = useRef("");
  useFrame(() => {
    const s = useStan.getState();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const items: { id: DomId; x: number; y: number; depth: number; slot: Slot }[] = [];
    for (const [id, slot] of labelSlots) {
      if (!slot.el) continue;
      const d = reg.domy.get(id);
      if (!d) continue;
      if (!slot.anchor) slot.anchor = new THREE.Vector3(d.center.x, d.box.max.y + 0.4, d.center.z);
      v.copy(slot.anchor).project(camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const depth = camera.position.distanceTo(slot.anchor);
      const walkNear = s.tryb === "spacer" && depth < 16;
      if (behind || walkNear || x < -200 || x > size.width + 200) {
        slot.el.style.visibility = "hidden";
        if (slot.line) slot.line.style.visibility = "hidden";
        continue;
      }
      items.push({ id, x, y, depth, slot });
    }
    items.sort((a, b) => a.depth - b.depth);
    let sig = "";
    for (const it of items) {
      const el = it.slot.el!;
      const w = el.offsetWidth || 120;
      const h = el.offsetHeight || 30;
      let top = it.y - 10 - h;
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((p) => Math.abs(p.x - it.x) < (p.w + w) / 2 + 6 && top < p.y + p.h + 4 && top + h > p.y - 4);
        if (!hit) break;
        top = hit.y - h - 6;
      }
      placed.push({ x: it.x, y: top, w, h });
      // pod górnym paskiem (kompas, punkty spaceru) etykiet nie pokazujemy
      if (top < (s.tryb === "spacer" ? 112 : 64)) {
        el.style.visibility = "hidden";
        if (it.slot.line) it.slot.line.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${Math.round(it.x - w / 2)}px, ${Math.round(top)}px)`;
      const line = it.slot.line;
      if (line) {
        const len = it.y - (top + h);
        line.style.visibility = len > 14 ? "visible" : "hidden";
        line.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(top + h)}px)`;
        line.style.height = `${Math.max(0, len - 2)}px`;
      }
      sig += `${it.id}${Math.round(top)}`;
    }
    if (sig !== last.current) last.current = sig;
    void s;
  });
  return null;
}

/** Warstwa DOM etykiet domów (poza canvasem). */
export function HouseLabelsDom() {
  const s = useStan();
  const show = s.etykiety && !(s.widok === "osiedle" && s.tryb === "model" && s.zdjecie) && s.scenaGotowa;
  const inHouse = s.widok === "dom";
  const hideAll = inHouse && (s.tryb === "spacer" || s.kond !== "dom" || s.tryb === "rzut");
  useEffect(() => {
    (window as unknown as { __three?: { invalidate: () => void } }).__three?.invalidate();
  });
  return (
    <div className="labels-layer" style={{ display: show && !hideAll ? "block" : "none" }}>
      {DOMY.map((d) => {
        if (inHouse && d.id !== s.dom) return null;
        const sold = d.status === "sprzedany";
        const hover = s.hover === d.id;
        return (
          <div key={d.id}>
            <div className="lbl-line" ref={(el) => { slot(d.id).line = el; }} />
            <div
              ref={(el) => { slot(d.id).el = el; }}
              className={`lbl abs${sold ? " sold" : ""}${hover ? " hover" : ""}`}
              onPointerEnter={() => s.set({ hover: d.id })}
              onPointerLeave={() => s.set({ hover: null })}
              onClick={() => (inHouse ? null : nav.dom(d.id))}
            >
              {inHouse ? `Dom ${d.id}` : etykieta(d)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function slot(id: DomId): Slot {
  let x = labelSlots.get(id);
  if (!x) labelSlots.set(id, (x = { el: null, line: null, anchor: null }));
  return x;
}

export function RoomLabels() {
  const s = useStan();
  if (!s.etykiety || s.widok !== "dom" || !s.dom || s.tryb === "spacer") return null;
  if (s.kond === "dom" && s.tryb !== "rzut") return null;
  const w = reg.wnetrza.get(s.dom);
  if (!w) return null;
  const k = s.kond === "dom" ? 0 : s.kond;
  return (
    <>
      {w.punkty
        .filter((p) => p.kond === k)
        .map((p) => (
          <Html key={p.id} position={[p.pos[0], p.pos[1] + 1.2, p.pos[2]]} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div className="lbl room go" title="Wejdź tutaj" onClick={() => s.set({ tryb: "spacer", punkt: p.id })}>
              {p.etykieta}
            </div>
          </Html>
        ))}
    </>
  );
}
