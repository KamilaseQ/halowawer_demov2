import { useEffect, useRef } from "react";
import { uruchomKreator } from "./silnik";
import { MOBILNE } from "../three/models";
import { nav, useStan } from "../state/store";
import "./kreator.css";

/** Pełnoekranowy kreator wnętrza nad makietą osiedla. Makieta w tym czasie nie renderuje (Stage: frameloop "never"),
    a kreator przy zamknięciu zwalnia swój kontekst WebGL. Ładowany leniwie (osobny plik JS). */
export default function Kreator() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = useStan.getState();
    const etykieta = s.widok === "dom" && s.dom ? `Wróć do domu ${s.dom}` : "Wróć do osiedla";
    const k = uruchomKreator(ref.current!, { onZamknij: () => nav.kreator(false), etykietaPowrotu: etykieta, mobilne: MOBILNE });
    return () => k.zniszcz();
  }, []);
  return <div className="kr" ref={ref} />;
}
