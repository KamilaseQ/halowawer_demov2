import { useEffect } from "react";
import { useStan, type Kond, type Pora, type Tryb } from "./store";
import { DOM_IDS, type DomId } from "../data/domy";

/* Stan ↔ hash URL. Przykłady:
   #/osiedle?zdjecie=1
   #/osiedle?tryb=spacer&punkt=PKT_OGRODY_A_B&pora=noc
   #/dom/D?kond=1
   #/dom/D?tryb=spacer&punkt=PKT_0_SALON                                   */

function parse(hash: string) {
  const [path, q = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const qs = new URLSearchParams(q);
  const out: Partial<ReturnType<typeof useStan.getState>> = {};
  if (parts[0] === "dom" && DOM_IDS.includes(parts[1] as DomId)) {
    out.widok = "dom";
    out.dom = parts[1] as DomId;
    out.zdjecie = false;
  } else {
    out.widok = "osiedle";
    out.dom = null;
    out.zdjecie = qs.get("zdjecie") !== "0" && !qs.get("tryb");
  }
  const tryb = qs.get("tryb") as Tryb | null;
  out.tryb = tryb && ["model", "spacer", "rzut"].includes(tryb) ? tryb : "model";
  const kond = qs.get("kond");
  out.kond = (kond === "0" ? 0 : kond === "1" ? 1 : "dom") as Kond;
  if (out.tryb === "rzut" && out.kond === "dom") out.kond = 0;
  const pora = qs.get("pora") as Pora | null;
  out.pora = pora && ["rano", "dzien", "noc"].includes(pora) ? pora : "dzien";
  out.punkt = qs.get("punkt");
  const nas = qs.get("nasl");
  if (nas) {
    const [m, h] = nas.split("-").map(Number);
    out.naslonecznienie = true;
    out.miesiac = Math.min(12, Math.max(1, Math.round(m) || 6));
    out.godzina = Math.min(23, Math.max(3, h || 15));
    out.zdjecie = false;
  } else out.naslonecznienie = false;
  out.etykiety = qs.get("etykiety") !== "0";
  return out;
}

function serialize(s: ReturnType<typeof useStan.getState>) {
  const qs = new URLSearchParams();
  if (s.widok === "osiedle" && s.tryb === "model" && !s.naslonecznienie) qs.set("zdjecie", s.zdjecie ? "1" : "0");
  if (s.tryb !== "model") qs.set("tryb", s.tryb);
  if (s.widok === "dom" && s.kond !== "dom" && s.tryb !== "spacer") qs.set("kond", String(s.kond));
  if (s.punkt && s.tryb === "spacer") qs.set("punkt", s.punkt);
  if (s.naslonecznienie) qs.set("nasl", `${s.miesiac}-${Math.round(s.godzina * 100) / 100}`);
  else if (s.pora !== "dzien") qs.set("pora", s.pora);
  if (!s.etykiety) qs.set("etykiety", "0");
  const path = s.widok === "dom" && s.dom ? `/dom/${s.dom}` : "/osiedle";
  const q = qs.toString();
  return `#${path}${q ? "?" + q : ""}`;
}

export function useRouteSync() {
  useEffect(() => {
    const apply = () => useStan.getState().set(parse(location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    let last = location.hash;
    const unsub = useStan.subscribe((s) => {
      const h = serialize(s);
      if (h !== last && h !== location.hash) {
        // nowy wpis w historii tylko przy zmianie widoku (osiedle ↔ dom, tryb), reszta podmienia bieżący
        const pathOf = (x: string) => x.split("?")[0] + "|" + (new URLSearchParams(x.split("?")[1] ?? "").get("tryb") ?? "");
        if (pathOf(h) !== pathOf(location.hash)) history.pushState(null, "", h);
        else history.replaceState(null, "", h);
        last = h;
      }
    });
    return () => {
      window.removeEventListener("hashchange", apply);
      unsub();
    };
  }, []);
}
