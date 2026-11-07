import { create } from "zustand";
import type { DomId } from "../data/domy";

export type Widok = "osiedle" | "dom";
/** Narzędzie z lewej szyny. Na osiedlu: model | spacer. W domu: model | spacer | rzut | galeria. */
export type Tryb = "model" | "spacer" | "rzut" | "galeria";
export type Pora = "rano" | "dzien" | "noc";
/** Kondygnacja w widoku domu: "dom" = cała bryła z dachem, 1 = piętro z góry, 0 = parter z góry. */
export type Kond = "dom" | 0 | 1;

export interface PunktSpaceru {
  id: string;
  etykieta: string;
  /** Pozycja na poziomie gruntu/posadzki, układ GLB. */
  pos: [number, number, number];
  kond?: number;
}

interface Stan {
  widok: Widok;
  dom: DomId | null;
  tryb: Tryb;
  kond: Kond;
  pora: Pora;
  /** tryb Nasłonecznienie: prawdziwe słońce dla miesiąca i godziny (52,2°N), cienie przypięte do świata */
  naslonecznienie: boolean;
  miesiac: number;
  godzina: number;
  zdjecie: boolean;
  etykiety: boolean;
  hover: DomId | null;
  /** Wybrany dom na osiedlu (karta), bez wchodzenia. */
  karta: DomId | null;
  punkt: string | null;
  /** Punkty spaceru dostępne w bieżącym widoku (z GLB). */
  punkty: PunktSpaceru[];
  scenaGotowa: boolean;
  /** zieleń i okolica (pliki z manifestu) wczytane */
  dodatkiGotowe: boolean;
  /** wnętrze bieżącego domu: null = dom nie ma wnętrza w manifeście */
  wnetrzeGotowe: boolean | null;
  postep: number;
  galeria: number | null;
  set: (p: Partial<Stan>) => void;
}

export const useStan = create<Stan>((set) => ({
  widok: "osiedle",
  dom: null,
  tryb: "model",
  kond: "dom",
  pora: "dzien",
  naslonecznienie: false,
  miesiac: 6,
  godzina: 15, // czas cieni zapisany w SKP: 21.06, 15:00
  zdjecie: true,
  etykiety: true,
  hover: null,
  karta: null,
  punkt: null,
  punkty: [],
  scenaGotowa: false,
  dodatkiGotowe: false,
  wnetrzeGotowe: null,
  postep: 0,
  galeria: null,
  set: (p) => set(p),
}));

/* Akcje nawigacji (jedno miejsce, żeby UI i scena zmieniały stan spójnie). */
export const nav = {
  osiedle() {
    useStan.getState().set({ widok: "osiedle", dom: null, tryb: "model", kond: "dom", punkt: null, karta: null, galeria: null });
  },
  dom(id: DomId, kond: Kond = "dom") {
    useStan.getState().set({ widok: "dom", dom: id, tryb: "model", kond, punkt: null, karta: null, zdjecie: false, galeria: null });
  },
  tryb(t: Tryb) {
    const s = useStan.getState();
    if (t === "galeria") return s.set({ galeria: 0 });
    s.set({ tryb: t, punkt: null, zdjecie: false, galeria: null, kond: t === "rzut" && s.kond === "dom" ? 0 : s.kond });
  },
};
