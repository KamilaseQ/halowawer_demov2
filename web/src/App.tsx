import { Stage } from "./three/Stage";
import { PhotoLayer } from "./ui/PhotoLayer";
import { Kompas } from "./ui/Kompas";
import { BottomBar, Floors, Gallery, Hint, HouseCard, Loader, LadowanieWnetrza, Note, Rail, Spots, TopLeft, TopRight } from "./ui/Chrome";
import { useRouteSync } from "./state/route";
import { HouseLabelsDom } from "./three/Labels";

export default function App() {
  useRouteSync();
  return (
    <div className={`app${new URLSearchParams(location.search).has("czysty") ? " czysty" : ""}`}>
      <Stage />
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
      <Note />
      <Hint />
      <Loader />
      <LadowanieWnetrza />
      <Gallery />
    </div>
  );
}
