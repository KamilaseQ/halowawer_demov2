import { lazy, Suspense, useEffect, useState } from "react";
import { Stage } from "./three/Stage";
import { PhotoLayer } from "./ui/PhotoLayer";
import { Kompas } from "./ui/Kompas";
import { BottomBar, Floors, Gallery, Hint, HouseCard, KreatorCta, KreatorOslona, Loader, LadowanieWnetrza, Note, Rail, Spots, TopLeft, TopRight } from "./ui/Chrome";
import { useRouteSync } from "./state/route";
import { useStan } from "./state/store";
import { HouseLabelsDom } from "./three/Labels";

// kreator wnętrza w osobnym pliku JS: makieta osiedla nie czeka na jego kod
const Kreator = lazy(() => import("./kreator/Kreator"));

export default function App() {
  useRouteSync();
  const kreator = useStan((s) => s.kreator);
  // wejście prosto w kreator (#/kreator): makieta osiedla zaczyna się wczytywać dopiero po jego zamknięciu,
  // żeby nie zabierała łącza i pamięci (getState: efekt trasy wyżej już ustawił stan z adresu)
  const [scena, setScena] = useState(() => !location.hash.startsWith("#/kreator"));
  useEffect(() => {
    if (!useStan.getState().kreator) setScena(true);
  }, [kreator]);
  return (
    <div className={`app${new URLSearchParams(location.search).has("czysty") ? " czysty" : ""}`}>
      {scena && <Stage />}
      <HouseLabelsDom />
      <PhotoLayer />
      <Kompas />
      <TopLeft />
      <TopRight />
      <Rail />
      <Floors />
      <Spots />
      <HouseCard />
      <BottomBar />
      <KreatorCta />
      <Note />
      <Hint />
      <Loader />
      <LadowanieWnetrza />
      <Gallery />
      {kreator && (
        <Suspense fallback={<KreatorOslona />}>
          <Kreator />
        </Suspense>
      )}
    </div>
  );
}
