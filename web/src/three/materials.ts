import * as THREE from "three";
import { reg } from "./models";

/* Materiały, które runtime przejmuje po nazwie (kontrakt §4): reszta zostaje z GLB od dostawców. */

const szybaCache = new Map<string, THREE.MeshPhysicalMaterial>();

/** Wieczorne okno: świeci całe (ciepłe wnętrze), firana jaśniejsza od tła pokoju (głębia jak na b2).
    Emisja = kolor × (0,3 + 0,95 × mapa). Na piętrze świeci tylko część okien: o tym, czy dane okno jest
    zapalone, decyduje stały skrót z położenia okna w świecie (siatka ok. 2,2 m), porównany z userData.udzial.
    Wywołać też po clone(). */
export function oknoNoc(m: THREE.MeshPhysicalMaterial) {
  if (!m.emissiveMap) return m;
  const NL = String.fromCharCode(10);
  m.onBeforeCompile = (sh) => {
    const u = m.userData;
    sh.uniforms.uOknoUdzial = { value: (u.udzial as number) ?? 1 };
    sh.uniforms.uOknoSrodek = { value: new THREE.Vector2(...((u.srodek as [number, number]) ?? [0, 0])) };
    sh.uniforms.uOknoGrunt = { value: (u.grunt as number) ?? -1e4 };
    sh.uniforms.uOknoJasP = { value: (u.jasP as number) ?? 1 };
    sh.uniforms.uOknoJasG = { value: (u.jasG as number) ?? 1.1 };
    sh.uniforms.uOknoSeed = { value: (u.seed as number) ?? 0 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", ["#include <common>", "varying vec3 vOknoWp;"].join(NL))
      .replace("#include <worldpos_vertex>", ["#include <worldpos_vertex>", "vOknoWp = (modelMatrix * vec4(transformed, 1.0)).xyz;"].join(NL));
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", ["#include <common>", "varying vec3 vOknoWp;", "uniform float uOknoUdzial; uniform vec2 uOknoSrodek; uniform float uOknoGrunt; uniform float uOknoJasP; uniform float uOknoJasG; uniform float uOknoSeed;"].join(NL))
      .replace(
        "#include <emissivemap_fragment>",
        [
          "#ifdef USE_EMISSIVEMAP",
          "  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );",
          // kondygnacja z wysokości nad gruntem domu; okno = połowa domu × strona elewacji × kondygnacja
          "  float oknoPietro = step(2.9, vOknoWp.y - uOknoGrunt);",
          "  vec2 oknoRel = vOknoWp.xz - uOknoSrodek;",
          "  float oknoId = step(0.0, oknoRel.x) + 2.0 * step(0.0, oknoRel.y) + 4.0 * oknoPietro + uOknoSeed * 8.0;",
          "  float oknoH = fract(sin(oknoId * 12.9898 + 4.1) * 43758.5453);",
          "  float oknoLit = mix(1.0, step(oknoH, uOknoUdzial), oknoPietro);",
          "  totalEmissiveRadiance *= (0.3 + 0.95 * emissiveColor.rgb) * oknoLit * mix(uOknoJasP, uOknoJasG, oknoPietro);",
          "#endif",
        ].join(NL),
      );
  };
  m.customProgramCacheKey = () => "okno-noc-3";
  return m;
}

export function szyba(src: THREE.Material): THREE.MeshPhysicalMaterial {
  const key = src.name + ((src as THREE.MeshStandardMaterial).map ? "#map" : "");
  let m = szybaCache.get(key);
  if (!m) {
    const s = src as THREE.MeshStandardMaterial;
    // Kontrakt z 96: jeśli szyba ma baseColor (firany + ciemne wnętrze), zostawiamy mapę,
    // dokładamy tylko odbicie nieba; wieczorem świeci ta sama mapa (ciepłe okna z firanami).
    m = new THREE.MeshPhysicalMaterial({
      name: src.name,
      // odbicie nieba jak na renderach (Fresnel szkła + powłoka); mapa firan lekko przyciemniona pod odbiciem
      color: s.map ? new THREE.Color(0.74, 0.74, 0.74) : new THREE.Color("#2a3236"),
      map: s.map ?? null,
      metalness: 0.0,
      roughness: 0.04,
      // F0 ≈ 0,17: stała część odbicia jak na renderach (b1), a nie 4% szkła na wprost
      ior: 2.4,
      specularIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.4,
      // zmierzch b2/b5: ciepła, brzoskwiniowo-różowa poświata wnętrza (nie żółta)
      emissive: new THREE.Color((window as unknown as { __okno?: string }).__okno ?? "#f6b9a2"),
      emissiveMap: s.map ?? null,
      emissiveIntensity: 0,
    });
    if (s.map) m.userData.maOkno = true;
    oknoNoc(m);
    szybaCache.set(key, m);
    reg.szyby.push(m);
  }
  return m;
}

/** Szyba okna we wnętrzu: przezroczysta, z lekkim odbiciem. Materiał okna elewacji (szyba()) jest
    nieprzezroczysty (firany i ciemne wnętrze widziane z zewnątrz), więc od środka okno było granatową płytą. */
const szybaWnCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function szybaWnetrze(src: THREE.Material): THREE.MeshPhysicalMaterial {
  let m = szybaWnCache.get(src.name);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      name: src.name,
      color: new THREE.Color("#f4f6f5"),
      metalness: 0,
      roughness: 0.03,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 0.6,
      specularIntensity: 1,
    });
    szybaWnCache.set(src.name, m);
  }
  return m;
}

export function przygotujMaterial(mesh: THREE.Mesh, mat: THREE.Material): THREE.Material {
  const n = (mat.name || "").toUpperCase();
  if (n.startsWith("SZYB") || n.startsWith("SZYBA")) return szyba(mat);
  const sm = mat as THREE.MeshStandardMaterial;
  if (n.startsWith("OGRODZ")) {
    sm.transparent = false;
    sm.alphaTest = 0.5;
    sm.depthWrite = true;
    sm.side = THREE.DoubleSide;
  }
  // osiedle-v14: lekko wykończone domy kontekstu (decyzja użytkownika 08.11): KONTEKST_SCIANA / _DACH / _OKNO
  // biorą kolor i chropowatość z GLB; szyba okna z mocniejszym refleksem nieba (envMapIntensity). Dokładnie „KONTEKST” (v12/v13,
  // duchy okolicy) zostaje neutralną bielą poniżej.
  if (n.startsWith("KONTEKST_")) {
    const okno = n.startsWith("KONTEKST_OKNO");
    return new THREE.MeshStandardMaterial({
      name: mat.name,
      color: sm.color ? sm.color.clone() : new THREE.Color("#e7e4de"),
      roughness: sm.roughness ?? (okno ? 0.38 : 0.95), // z GLB (okno 0,38 wg b7: 0,35–0,4)
      metalness: 0,
      side: mat.side,
      envMapIntensity: okno ? 1.0 : 0.6,
    });
  }
  if (n.startsWith("KONTEKST")) {
    // strona jak w GLB (flaga doubleSided → mat.side). osiedle-v12: doubleSided true, bo bryły kontekstu SKP nie są
    // zamknięte i jednostronny materiał pokazywał szczelinę z widokiem na ulicę (e3 R11, KONTEKST_3 za C/D).
    // Od v13 96 daje odwrócone kopie lic i doubleSided false, więc wtedy FrontSide (bez podwójnego rysowania).
    const g = new THREE.MeshStandardMaterial({ name: mat.name, color: "#e7e4de", roughness: 0.95, metalness: 0, side: mat.side });
    return g;
  }
  if (n.startsWith("LAMPA")) {
    if (sm.isMeshStandardMaterial) {
      // kule ogrodowe: mleczne szkło świecące ciepło (b2, b5), latarnie: ciepła żarówka
      sm.emissive = new THREE.Color(n.startsWith("LAMPA_KULA") ? "#fff0dc" : "#ffd9a0");
      sm.emissiveIntensity = 0;
      if (!reg.lampy.includes(sm)) reg.lampy.push(sm);
    }
  }
  if (sm.isMeshStandardMaterial) {
    sm.envMapIntensity = sm.envMapIntensity ?? 1;
    // AO wypalone przez 96 (occlusionTexture, TEXCOORD_1): lekko słabiej, bo dokładamy SSAO
    if (sm.aoMap) sm.aoMapIntensity = 0.8;
    // blacha na rąbek: matowa. Pod płaskim kątem (połać N w b4) Fresnel dawał lustrzany refleks słońca i nieba,
    // niezależny od koloru, więc dach staje się materiałem fizycznym z osłabionym odbiciem (specular 0,3).
    if (/DACH/.test(n) && !(sm as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const ph = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(ph, sm);
      ph.specularIntensity = 0.3;
      ph.roughness = Math.max(0.75, sm.roughness);
      ph.metalness = 0;
      ph.envMapIntensity = 0.6;
      ph.name = sm.name;
      return ph;
    }
    // przezroczystość z importu SKP bywa przypadkowa (alpha 0.99 itp.)
    if (sm.transparent && sm.opacity > 0.97 && !sm.map?.format) sm.transparent = false;
  }
  return mat;
}
