/* Dane kreatora wnętrza: grupy materiałów, palety, podłogi, gotowe style i pokoje do spaceru.
   Nazwy materiałów (M139 itd.) pochodzą ze sceny .max mieszkania (apartment.max), a ich oryginalne kolory,
   tekstury i połysk są w materialy.json. */

/** powierzchnie, które w źródle mają wspólny materiał, a w kreatorze są stylowane osobno */
export const OBJMAT = { "ZJ-191": "FLOOR2", "ZJ-192": "FLOOR2", "ZJ-190": "BATH" };
export const ALIAS = { FLOOR2: "M158", BATH: "M158" };
export const FLOORMATS = ["M135", "FLOOR2"];

export const GROUPS = [
  { id: "walls", label: "Ściany", pal: "walls", mats: ["M139"] },
  { id: "ceiling", label: "Sufit", pal: "ceiling", mats: ["M136"] },
  { id: "joinery", label: "Zabudowa i fronty", pal: "joinery", mats: ["M140", "M147", "M89", "M146"] },
  { id: "wood", label: "Drewno: wyspa, krzesła, ramy", pal: "wood", mats: ["M150", "M151", "M152", "M149"] },
  { id: "sofa", label: "Sofa", pal: "textile", mats: ["M153"] },
  { id: "accent", label: "Poduszki", pal: "textile", mats: ["M154", "M155"] },
  { id: "curtain", label: "Zasłony", pal: "textile", mats: ["M162", "M174"] },
  { id: "rug", label: "Dywan", pal: "textile", mats: ["M1"] },
  { id: "stone", label: "Kamień: blaty, okładziny, łazienka", pal: "stone", mats: ["M175", "M144", "M148", "BATH"] },
];

export const PAINTS = {
  walls: [["Biel śnieżna", "#f3f1ec"], ["Alabaster", "#e9e3d8"], ["Len", "#dcd2c0"], ["Greige", "#cbc2b4"], ["Piaskowy", "#d6bf9f"], ["Pudrowy róż", "#dfc3b9"], ["Terakota", "#bd7558"], ["Szałwia", "#b5bfa8"], ["Oliwka", "#8c9474"], ["Butelkowa zieleń", "#2f4a3f"], ["Mglisty błękit", "#b4c4ce"], ["Granat", "#2e3d54"], ["Beton", "#a7a6a2"], ["Grafit", "#494b4f"]],
  ceiling: [["Biel śnieżna", "#f6f5f1"], ["Alabaster", "#ebe6dc"], ["Len", "#ddd4c4"], ["Jasny beton", "#c9c8c4"], ["Grafit", "#494b4f"], ["Czerń matowa", "#26282a"]],
  floorTint: [["Naturalny", "#ffffff"], ["Rozbielony", "#fff6ea"], ["Miodowy", "#f2cf9f"], ["Szary", "#b9bcbd"], ["Wędzony", "#8f7a66"], ["Ciemny", "#5e5148"]],
  joinery: [["Biały mat", "#eeece7"], ["Kaszmir", "#d8cfc2"], ["Jasny dąb", "#cfb48f"], ["Dąb naturalny", "#b08a5e"], ["Orzech", "#6e4f38"], ["Szałwia", "#9aa58e"], ["Granat", "#2f3c50"], ["Grafit", "#3e4144"], ["Czerń", "#232526"]],
  wood: [["Bielony", "#e3d3ba"], ["Jasny dąb", "#d0b48c"], ["Dąb", "#b08a5e"], ["Orzech", "#7a5a3e"], ["Wenge", "#4a3a30"], ["Czarny", "#262524"], ["Szary", "#9c9790"]],
  textile: [["Ecru", "#e6dfd2"], ["Jasny szary", "#bfc1c0"], ["Piasek", "#cdb89a"], ["Karmel", "#b0764a"], ["Rdza", "#a6553a"], ["Oliwka", "#7d8463"], ["Butelkowa zieleń", "#33503f"], ["Błękit", "#8fa6b8"], ["Granat", "#2b3a52"], ["Antracyt", "#3d4043"]],
  stone: [["Biały", "#f2f0ec"], ["Piaskowy", "#d9cbb6"], ["Szary", "#9a9b9c"], ["Zielony", "#5d7566"], ["Grafit", "#45474a"], ["Czarny", "#1f2021"]],
};

export const FLOORS = [["tile", "Gres"], ["plank", "Deska dąb"], ["herring", "Jodełka"], ["ash", "Deska jasna"], ["walnut", "Orzech"], ["herringw", "Jodełka orzech"], ["marble", "Marmur"], ["marble2", "Marmur biały"], ["concrete", "Beton"]];

export const STYLES = [
  { id: "orig", name: "Oryginalny", desc: "jak w plikach 3D", fan: ["#dcdcdc", "#b9b6b0", "#c8b08a", "#222222"], floor: "tile", tint: "#ffffff", all: false },
  { id: "scandi", name: "Skandynawski", desc: "biel i jasne drewno", walls: "#f3f1ec", ceiling: "#f6f5f1", floor: "ash", tint: "#ffffff", joinery: "#eeece7", wood: "#d0b48c", sofa: "#8fa6b8", accent: "#e6dfd2", curtain: "#e6dfd2", rug: "#bfc1c0" },
  { id: "japandi", name: "Japandi", desc: "len, dąb, oliwka", walls: "#dcd2c0", ceiling: "#ebe6dc", floor: "plank", tint: "#ffffff", joinery: "#cfb48f", wood: "#7a5a3e", sofa: "#7d8463", accent: "#e6dfd2", curtain: "#cdb89a", rug: "#cdb89a" },
  { id: "loft", name: "Loft", desc: "beton, czerń, karmel", walls: "#a7a6a2", floor: "concrete", tint: "#b9bcbd", joinery: "#232526", wood: "#4a3a30", sofa: "#b0764a", accent: "#3d4043", curtain: "#3d4043", rug: "#3d4043", stone: "#45474a" },
  { id: "classic", name: "Modern classic", desc: "greige, jodełka, granat", walls: "#cbc2b4", ceiling: "#f6f5f1", floor: "herring", tint: "#f2cf9f", joinery: "#eeece7", wood: "#7a5a3e", sofa: "#2b3a52", accent: "#cdb89a", curtain: "#e6dfd2", rug: "#2b3a52", stone: "#f2f0ec" },
  { id: "dark", name: "Wieczorny", desc: "butelkowa zieleń, orzech", walls: "#2f4a3f", ceiling: "#ebe6dc", floor: "walnut", tint: "#ffffff", joinery: "#3e4144", wood: "#7a5a3e", sofa: "#cdb89a", accent: "#a6553a", curtain: "#cdb89a", rug: "#a6553a", stone: "#1f2021" },
  { id: "medi", name: "Śródziemnomorski", desc: "piasek, marmur, terakota", walls: "#e9e3d8", ceiling: "#f6f5f1", floor: "marble", tint: "#fff6ea", joinery: "#d8cfc2", wood: "#b08a5e", sofa: "#a6553a", accent: "#e6dfd2", curtain: "#e6dfd2", rug: "#b0764a", stone: "#d9cbb6" },
  { id: "pastel", name: "Pastelowy", desc: "róż, szałwia, jasna deska", walls: "#dfc3b9", ceiling: "#f6f5f1", floor: "ash", tint: "#fff6ea", joinery: "#9aa58e", wood: "#e3d3ba", sofa: "#e6dfd2", accent: "#33503f", curtain: "#e6dfd2", rug: "#8fa6b8" },
];
for (const s of STYLES) if (!s.fan) s.fan = [s.walls, s.joinery, s.sofa, s.accent];

/** punkty startowe spaceru: pozycja [x, z] i punkt, w który patrzy kamera */
export const ROOMS = [
  { id: "salon", name: "Salon", pos: [1.3, -2.5], look: [-2.2, -0.7] },
  { id: "kuchnia", name: "Kuchnia", pos: [-0.3, 0.1], look: [2.6, -1.3] },
  { id: "garderoba", name: "Garderoba", pos: [-0.7, 1.0], look: [-2.6, 2.9] },
  { id: "lazienka", name: "Łazienka", pos: [1.35, 1.3], look: [2.7, 3.0] },
  { id: "gabinet", name: "Gabinet", pos: [-4.6, -0.1], look: [-4.3, 2.8] },
];

/** kamera widoku makiety mieszkania */
export const MODEL = { pos: [6.6, 13, -9.6], target: [-0.2, 0.3, 0.3] };
export const EYE = 1.6;
export const CLAY = "#bdb9b2";
