/* Dane domów. Źródła: statusy ze „Zdjecie całego osiedla.png”, metraże i ceny tylko tam,
   gdzie są w dostarczonych materiałach (inspiracje_ui/ui11). Brakujące pola uzupełnia klient. */

export type DomId = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type Status = "dostepny" | "sprzedany";

export interface Dom {
  id: DomId;
  segment: "A+B" | "C+D" | "E+F+G";
  rodzaj: "bliźniak" | "szeregowiec";
  status: Status;
  /** Powierzchnia użytkowa w m² (null = do uzupełnienia). */
  pow: number | null;
  /** Cena w zł (null = do uzupełnienia albo sprzedany). */
  cena: number | null;
}

export const DOMY: Dom[] = [
  { id: "A", segment: "A+B", rodzaj: "bliźniak", status: "dostepny", pow: null, cena: null },
  { id: "B", segment: "A+B", rodzaj: "bliźniak", status: "dostepny", pow: null, cena: null },
  { id: "C", segment: "C+D", rodzaj: "bliźniak", status: "sprzedany", pow: null, cena: null },
  { id: "D", segment: "C+D", rodzaj: "bliźniak", status: "dostepny", pow: 119.8, cena: 1_590_000 },
  { id: "E", segment: "E+F+G", rodzaj: "szeregowiec", status: "dostepny", pow: 99.8, cena: 1_490_000 },
  { id: "F", segment: "E+F+G", rodzaj: "szeregowiec", status: "dostepny", pow: 103.0, cena: 1_450_000 },
  { id: "G", segment: "E+F+G", rodzaj: "szeregowiec", status: "sprzedany", pow: null, cena: null },
];

export const DOM_IDS = DOMY.map((d) => d.id);
export const domById = (id: string | null | undefined) => DOMY.find((d) => d.id === id) ?? null;

const NB = " ";
export const fmtPow = (m2: number) => `${m2.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${NB}m²`;
export const fmtCenaMln = (zl: number) =>
  `${(zl / 1_000_000).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NB}mln${NB}zł`;
export const fmtCena = (zl: number) => `${zl.toLocaleString("pl-PL")}${NB}zł`;

/** Tekst etykiety: „D · 119,8 m² · 1,59 mln zł”, „C · sprzedany”, „A · dostępny”. */
export function etykieta(d: Dom): string {
  if (d.status === "sprzedany") return `${d.id} · sprzedany`;
  const parts: string[] = [d.id];
  if (d.pow) parts.push(fmtPow(d.pow));
  if (d.cena) parts.push(fmtCenaMln(d.cena));
  if (parts.length === 1) parts.push("dostępny");
  return parts.join(" · ");
}

/** Galeria: rendery dewelopera (referencje_wizualizacji), skopiowane do public/galeria. */
export const GALERIA_ZEWN = ["budynek1", "budynek2", "budynek3", "budynek4", "budynek5", "budynek6"];
export const GALERIA_WNETRZA: Record<"jodelka" | "deska", string[]> = {
  jodelka: ["1", "2", "3", "7", "9"],
  deska: ["4", "5", "6", "8", "10"],
};
