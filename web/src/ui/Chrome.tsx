import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useStan, nav, type Kond } from "../state/store";
import { domById, fmtCena, fmtPow, GALERIA_WNETRZA, GALERIA_ZEWN } from "../data/domy";
import { rig } from "../three/CameraRig";
import { dzien, fmtGodz, kierunek, MIESIACE, MIESIACE_DOP, MIESIACE_KR, sunPosition } from "../lib/slonce";
import { reg } from "../three/models";
import {
  IcoSun, IcoCamera, IcoChevL, IcoChevR, IcoCube, IcoDown, IcoEye, IcoEyeOff, IcoHome, IcoImage, IcoLeft, IcoMinus, IcoPlan, IcoPlus, IcoUp, IcoWalk, IcoX,
} from "./icons";

/* ---------- lewy górny róg ---------- */
export function TopLeft() {
  const s = useStan();
  if (s.widok === "dom") {
    return (
      <div className="top-left">
        <button className="pill-btn" onClick={() => nav.osiedle()}>
          <IcoLeft /> Osiedle
        </button>
      </div>
    );
  }
  if (s.tryb === "spacer") {
    return (
      <div className="top-left">
        <button className="pill-btn" onClick={() => s.set({ tryb: "model", punkt: null })}>
          <IcoLeft /> Makieta 3D
        </button>
      </div>
    );
  }
  return (
    <div className="top-left">
      <div className="brand glass">
        Halo Wawer<small>Makieta osiedla</small>
      </div>
    </div>
  );
}

/* ---------- prawy górny róg ---------- */
export function TopRight() {
  const etykiety = useStan((s) => s.etykiety);
  const set = useStan((s) => s.set);
  const shot = () => {
    const s = useStan.getState();
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    if (s.zdjecie && s.widok === "osiedle" && s.tryb === "model") {
      a.href = "/photo/osiedle.jpg";
      a.download = `osiedle-zdjecie.jpg`;
    } else {
      const c = document.querySelector<HTMLCanvasElement>(".stage canvas");
      if (!c) return;
      a.href = c.toDataURL("image/png");
      a.download = `makieta-${s.dom ? "dom-" + s.dom + "-" : ""}${stamp}.png`;
    }
    a.click();
  };
  return (
    <div className="top-right">
      <button className="icon-btn" title="Zrzut ekranu" onClick={shot}>
        <IcoCamera />
      </button>
      <button className={`icon-btn${etykiety ? "" : " on"}`} title={etykiety ? "Ukryj etykiety" : "Pokaż etykiety"} onClick={() => set({ etykiety: !etykiety })}>
        {etykiety ? <IcoEyeOff /> : <IcoEye />}
      </button>
    </div>
  );
}

/* ---------- lewa szyna ---------- */
export function Rail() {
  const s = useStan();
  const ready = s.scenaGotowa;
  if (s.widok === "osiedle") {
    return (
      <nav className="rail">
        <button className={s.tryb === "model" ? "on" : ""} onClick={() => (s.tryb === "model" ? rig.reset() : nav.tryb("model"))} disabled={!ready} title="Makieta 3D (ponowne kliknięcie: główny widok)">
          <IcoCube /> Makieta 3D
        </button>
        <button className={s.tryb === "spacer" ? "on" : ""} onClick={() => nav.tryb("spacer")} disabled={!ready}>
          <IcoWalk /> Spacer
        </button>
      </nav>
    );
  }
  return (
    <nav className="rail">
      <button className={s.tryb === "model" ? "on" : ""} onClick={() => (s.tryb === "model" ? rig.reset() : nav.tryb("model"))}>
        <IcoCube /> Model 3D
      </button>
      <button className={s.tryb === "spacer" ? "on" : ""} onClick={() => nav.tryb("spacer")}>
        <IcoWalk /> Spacer
      </button>
      <button className={s.tryb === "rzut" ? "on" : ""} onClick={() => nav.tryb("rzut")} disabled={!s.dom || !reg.wnetrza.get(s.dom)}>
        <IcoPlan /> Rzut
      </button>
      <button className={s.galeria !== null ? "on" : ""} onClick={() => nav.tryb("galeria")}>
        <IcoImage /> Galeria
      </button>
    </nav>
  );
}

/* ---------- prawa pigułka kondygnacji ---------- */
const LEVELS: Kond[] = ["dom", 1, 0];
export function Floors() {
  const s = useStan();
  if (s.widok !== "dom" || !s.dom) return null;
  const hasInt = !!reg.wnetrza.get(s.dom);
  const walk = s.tryb === "spacer";
  const cur: Kond = walk ? (currentWalkLevel() as Kond) : s.kond;
  const choose = (k: Kond) => {
    if (!walk && k === s.kond && s.tryb === "model") return rig.reset();
    if (walk) {
      if (k === "dom") return nav.tryb("model");
      const w = reg.wnetrza.get(s.dom!);
      const p = w?.punkty.find((x) => x.kond === k);
      if (p) s.set({ punkt: p.id });
      return;
    }
    if (s.tryb === "rzut" && k === "dom") return s.set({ tryb: "model", kond: "dom" });
    s.set({ kond: k });
  };
  const idx = LEVELS.indexOf(cur);
  return (
    <div className="floors">
      <button className="chev" onClick={() => idx > 0 && choose(LEVELS[idx - 1])} disabled={idx <= 0 || !hasInt} title="Wyżej">
        <IcoUp />
      </button>
      <button className={cur === "dom" ? "on" : ""} onClick={() => choose("dom")} title="Cały dom">
        <IcoHome />
      </button>
      <button className={cur === 1 ? "on" : ""} onClick={() => choose(1)} disabled={!hasInt} title={hasInt ? "Piętro z góry" : "Wnętrze w przygotowaniu"}>
        1
      </button>
      <button className={cur === 0 ? "on" : ""} onClick={() => choose(0)} disabled={!hasInt} title={hasInt ? "Parter z góry" : "Wnętrze w przygotowaniu"}>
        P
      </button>
      <button className="chev" onClick={() => idx < LEVELS.length - 1 && choose(LEVELS[idx + 1])} disabled={idx >= LEVELS.length - 1 || !hasInt} title="Niżej">
        <IcoDown />
      </button>
    </div>
  );
}
function currentWalkLevel(): number | "dom" {
  const s = useStan.getState();
  const w = s.dom ? reg.wnetrza.get(s.dom) : null;
  if (!w) return "dom";
  const p = w.punkty.find((x) => x.id === s.punkt);
  if (p?.kond !== undefined) return p.kond;
  const y = rig.controls?.camera.position.y ?? 0;
  const levels = Object.entries(w.poziomy).sort((a, b) => b[1] - a[1]);
  for (const [k, lv] of levels) if (y > lv + 0.5) return +k;
  return 0;
}

/* ---------- dolny pasek ---------- */
export function BottomBar() {
  const s = useStan();
  const estateModel = s.widok === "osiedle" && s.tryb === "model";
  const photoOn = estateModel && s.zdjecie;
  return (
    <>
      {s.naslonecznienie && !photoOn && <SunPanel />}
      <div className="bottom glass">
        <div className="seg" role="group" aria-label="Pora dnia">
          {(["rano", "dzien", "noc"] as const).map((p) => (
            <button key={p} className={!s.naslonecznienie && s.pora === p ? "on" : ""} onClick={() => s.set({ pora: p, naslonecznienie: false })} disabled={photoOn}>
              {p === "rano" ? "Rano" : p === "dzien" ? "Dzień" : "Noc"}
            </button>
          ))}
        </div>
        <button
          className={`sunbtn${s.naslonecznienie ? " on" : ""}`}
          title="Nasłonecznienie: prawdziwe słońce dla wybranego miesiąca i godziny"
          onClick={() => s.set({ naslonecznienie: !s.naslonecznienie, zdjecie: false })}
          disabled={!s.scenaGotowa}
        >
          <IcoSun /> <span>Nasłonecznienie</span>
        </button>
        {estateModel && (
          <>
            <span className="sep" />
            <div className="seg" role="group" aria-label="Widok">
              <button className={s.zdjecie ? "on" : ""} onClick={() => s.set({ zdjecie: true, hover: null, naslonecznienie: false })}>
                Zdjęcie
              </button>
              <button className={!s.zdjecie ? "on" : ""} onClick={() => s.set({ zdjecie: false, hover: null })} disabled={!s.scenaGotowa}>
                Makieta 3D
              </button>
            </div>
          </>
        )}
        <span className="sep" />
        <button className="zoom" title="Oddal" onClick={() => rig.zoom(-1)} disabled={photoOn}>
          <IcoMinus />
        </button>
        <button className="zoom" title="Przybliż" onClick={() => rig.zoom(1)} disabled={photoOn}>
          <IcoPlus />
        </button>
      </div>
    </>
  );
}

/* ---------- panel nasłonecznienia: miesiąc + godzina, odczyt położenia słońca ---------- */
function SunPanel() {
  const m = useStan((s) => s.miesiac);
  const h = useStan((s) => s.godzina);
  const set = useStan((s) => s.set);
  const [rise, sunset] = dzien(m);
  const hh = Math.min(sunset, Math.max(rise, h));
  const { az, el } = sunPosition(m, hh);
  const setMonth = (nm: number) => {
    const [r, z] = dzien(nm);
    set({ miesiac: nm, godzina: Math.min(z, Math.max(r, h)) });
  };
  return (
    <div className="sunpanel glass">
      <div className="sp-row">
        <span className="sp-l">Miesiąc</span>
        <div className="sp-months">
          {MIESIACE_KR.map((n, i) => (
            <button key={n} className={m === i + 1 ? "on" : ""} onClick={() => setMonth(i + 1)} title={MIESIACE[i]}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-row">
        <span className="sp-l">Godzina</span>
        <span className="sp-t">{fmtGodz(rise)}</span>
        <input
          type="range"
          min={rise}
          max={sunset}
          step={0.25}
          value={hh}
          onChange={(e) => set({ godzina: +e.target.value })}
          aria-label="Godzina"
        />
        <span className="sp-t">{fmtGodz(sunset)}</span>
      </div>
      <div className="sp-read">
        <b>
          21 {MIESIACE_DOP[m - 1]}
        </b>{" "}
        · {fmtGodz(hh)} · słońce {kierunek(az)} {Math.round(az)}°, {Math.max(0, Math.round(el))}° nad horyzontem
      </div>
    </div>
  );
}

/* ---------- notka ---------- */
export function Note() {
  const show = useStan((s) => s.widok === "osiedle" && s.tryb === "model");
  return show ? <div className="note">Położenie budynków poglądowe</div> : null;
}

/* ---------- karta domu ---------- */
export function HouseCard() {
  const s = useStan();
  if (s.widok !== "dom" || s.tryb === "spacer" || s.galeria !== null) return null;
  const d = domById(s.dom);
  if (!d) return null;
  const hasInt = !!reg.wnetrza.get(d.id);
  return (
    <aside className="card">
      <button className="x" onClick={() => nav.osiedle()} title="Wróć do osiedla">
        <IcoX />
      </button>
      <h2>
        Dom {d.id} <span className={`status ${d.status}`}>{d.status === "sprzedany" ? "Sprzedany" : "Dostępny"}</span>
      </h2>
      <dl>
        <dt>Typ</dt>
        <dd>{d.rodzaj === "bliźniak" ? "Bliźniak" : "Szeregowiec"}</dd>
        <dt>Segment</dt>
        <dd>{d.segment}</dd>
        <dt>Powierzchnia</dt>
        <dd>{d.pow ? fmtPow(d.pow) : "—"}</dd>
        <dt>Cena</dt>
        <dd>{d.status === "sprzedany" ? "—" : d.cena ? fmtCena(d.cena) : "zapytaj"}</dd>
      </dl>
      <div className="acts">
        <button className="cta main" onClick={() => nav.tryb("spacer")}>
          <IcoWalk /> {hasInt ? "Spacer po domu" : "Spacer wokół domu"}
        </button>
        {hasInt && (
          <button className="cta sec" onClick={() => s.set({ tryb: "model", kond: s.kond === 0 ? 1 : 0 })}>
            {s.kond === 0 ? "Piętro z góry" : "Parter z góry"}
          </button>
        )}
      </div>
    </aside>
  );
}

/* ---------- pasek punktów spaceru ---------- */
export function Spots() {
  const s = useStan();
  if (s.tryb !== "spacer" || !s.punkty.length) return null;
  const title = s.widok === "dom" ? `Dom ${s.dom}` : "Osiedle";
  return (
    <div className="spots glass">
      <span className="ttl">{title}</span>
      {s.punkty.map((p) => (
        <button key={p.id} className={s.punkt === p.id ? "on" : ""} onClick={() => s.set({ punkt: p.id })}>
          {p.etykieta}
        </button>
      ))}
    </div>
  );
}

/* ---------- podpowiedzi ---------- */
export function Hint() {
  const s = useStan();
  const key = `${s.widok}-${s.tryb}-${s.zdjecie}-${s.kond}`;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    setShown(key);
    const t = setTimeout(() => setShown(null), 5200);
    return () => clearTimeout(t);
  }, [key]);
  if (shown !== key || !s.scenaGotowa) return null;
  let text = "";
  if (s.widok === "osiedle" && s.tryb === "model") text = s.zdjecie ? "Kliknij dom, aby zobaczyć go w 3D · przeciągnij, aby obrócić makietę" : "Przeciągnij, aby obrócić · kółko, aby przybliżyć · kliknij dom";
  else if (s.tryb === "spacer") text = "Kliknij w " + (s.widok === "dom" && s.dom && reg.wnetrza.get(s.dom) ? "podłogę" : "teren") + ", aby przejść · przeciągnij, aby się rozejrzeć";
  else if (s.widok === "dom" && s.kond !== "dom") text = "Kliknij nazwę pomieszczenia, aby do niego wejść";
  if (!text) return null;
  return <div className="hint">{text}</div>;
}

/* ---------- ładowanie ---------- */
export function Loader() {
  const postep = useProgress((p) => p.progress);
  const gotowa = useStan((s) => s.scenaGotowa);
  return (
    <div className={`loader glass${gotowa ? " done" : ""}`}>
      Wczytywanie makiety 3D
      <span className="bar">
        <i style={{ width: `${Math.max(4, postep)}%` }} />
      </span>
      {Math.round(postep)}%
    </div>
  );
}

/* ---------- galeria ---------- */
export function Gallery() {
  const s = useStan();
  const i = s.galeria;
  useEffect(() => {
    if (i === null) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") s.set({ galeria: null });
      if (e.key === "ArrowRight") s.set({ galeria: ((i ?? 0) + 1) % list.length });
      if (e.key === "ArrowLeft") s.set({ galeria: ((i ?? 0) - 1 + list.length) % list.length });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  if (i === null) return null;
  const d = domById(s.dom);
  const wn = d?.rodzaj === "szeregowiec" ? GALERIA_WNETRZA.deska : GALERIA_WNETRZA.jodelka;
  const list = [...wn.map((n) => ({ n, cap: "Wnętrze" })), ...GALERIA_ZEWN.map((n) => ({ n, cap: "Elewacja" }))];
  const cur = list[i % list.length];
  return (
    <div className="gallery" onClick={(e) => e.target === e.currentTarget && s.set({ galeria: null })}>
      <div className="cap">
        {d ? `Dom ${d.id} · ` : ""}
        {cur.cap} · {(i % list.length) + 1} / {list.length}
      </div>
      <button className="icon-btn close" onClick={() => s.set({ galeria: null })} title="Zamknij">
        <IcoX />
      </button>
      <div className="main">
        <img src={`/galeria/${cur.n}.jpg`} alt={cur.cap} />
        <button className="nav l" onClick={() => s.set({ galeria: (i - 1 + list.length) % list.length })}>
          <IcoChevL />
        </button>
        <button className="nav r" onClick={() => s.set({ galeria: (i + 1) % list.length })}>
          <IcoChevR />
        </button>
      </div>
      <div className="thumbs">
        {list.map((x, k) => (
          <button key={x.n} className={k === i % list.length ? "on" : ""} onClick={() => s.set({ galeria: k })}>
            <img src={`/galeria/m/${x.n}.jpg`} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
