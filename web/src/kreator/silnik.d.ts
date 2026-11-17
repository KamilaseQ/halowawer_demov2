export interface OpcjeKreatora {
  /** przycisk powrotu w pasku widoków */
  onZamknij?: () => void;
  etykietaPowrotu?: string;
  /** telefon: mniejsza mapa cieni, tekstury podłóg i rozdzielczość */
  mobilne?: boolean;
}

export interface Kreator {
  /** zatrzymuje pętlę i zwalnia całą pamięć GPU (kontekst WebGL kreatora) */
  zniszcz(): void;
}

export function uruchomKreator(root: HTMLElement, opts?: OpcjeKreatora): Kreator;
