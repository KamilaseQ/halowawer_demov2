import * as THREE from "three";
import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { zbudujLustra, synchronizujLustra, WARSTWA_WNETRZ } from "./lustra";
import { useGLB, useManifest, modelUrl, reg, anizotropiaMax, NOWE_LADOWANIE, LM_KTX2, ktx2Loader, postepPliku, zakonczPlik, zglosPliki, type WnetrzeInfo, type Kadr } from "./models";
import { szybaWnetrze } from "./materials";
import { useStan, type PunktSpaceru } from "../state/store";
import type { DomId } from "../data/domy";
import { rig } from "./CameraRig";
import { utworzPrzekroj, ustawPrzekroj, ustawSkorupe, WIERZCH_SCIANY, PLASZCZYZNA_WNETRZ } from "./przekroj";

/** wysokość cięcia rzutu nad posadzką kondygnacji (STANDARD_WIZUALNY §8a) */
const CIECIE_RZUTU = 1.3;
/** widok kondygnacji (Model 3D): cięcie tuż nad wierzchami ścian (extras.wierzch na KOND_n); bez extras (GLB sprzed v19/v13)
    przybliżenie: posadzka + 2,68 m */
const NAD_WIERZCHEM = 0.003;
const WIERZCH_DOMYSLNY = 2.68;

/** Który plik wnętrza i jaka macierz dla domu (manifest.domy). */
export function interiorFor(man: ReturnType<typeof useManifest>, id: DomId | null) {
  if (!id || !man.domy || !man.wnetrza) return null;
  const d = man.domy[id] as { wnetrze: string; macierz: number[] | null; lightmapy?: Record<string, string> } | undefined;
  if (!d) return null;
  const file = man.wnetrza[d.wnetrze];
  if (!file) return null;
  return { file, macierz: d.macierz, lightmapy: d.lightmapy };
}

/* ---------- lightmapy (kontrakt §4): extras węzła { lightMap, lightMapIntensity } albo manifest.domy.X.lightmapy ----------
   Siatka z lightmapą bierze światło tylko z mapy (słońce + niebo + GI wypalone w Cycles) i słabe odbicia otoczenia;
   światła kierunkowe i półkula runtime są dla niej wyłączone, żeby nie liczyć słońca dwa razy. */
const texLoader = new THREE.TextureLoader();
const lmCache = new Map<string, THREE.Texture>();
export const lightmapMats: THREE.MeshStandardMaterial[] = [];
const LM_TINT: [number, number, number] = [1.04, 1.0, 0.94];
// NOWE_LADOWANIE: dekodowanie lightmap WebP w tle (createImageBitmap), a nie w wątku głównym przy wysyłce na GPU
const bitmapLoader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
function lmTexture(url: string) {
  let t = lmCache.get(url);
  if (!t && NOWE_LADOWANIE) {
    // sam obiekt tekstury (shadery kompilują się z wariantem lightmapy już przy rozgrzewce),
    // a obraz dekodujemy dopiero, gdy dom zostanie wybrany (zaladujLightmapy): lightmapy wszystkich
    // domów naraz zajęłyby ok. 1,4 GB po rozpakowaniu
    const tex = new THREE.Texture();
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.channel = 1;
    tex.anisotropy = anizotropiaMax();
    tex.generateMipmaps = true;
    tex.userData.url = url;
    lmCache.set(url, tex);
    return tex;
  }
  if (!t) {
    t = texLoader.load(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.channel = 1;
    t.anisotropy = anizotropiaMax();
    lmCache.set(url, t);
  }
  return t;
}
/** LM_KTX2: wszystkie lightmapy wnętrz (wszystkie domy, warianty -L i r) jako KTX2 za ekranem ładowania.
    Tekstura-zaślepka z lmTexture zostaje podmieniona w materiałach na skompresowaną (po adresie). */
let lmKtx2Obietnica: Promise<void> | null = null;
export function wczytajLightmapyKtx2(): Promise<void> {
  if (lmKtx2Obietnica) return lmKtx2Obietnica;
  const zaslepki = [...lmCache.values()].filter((t) => t.userData.url);
  const adresy = zaslepki.map((t) => (t.userData.url as string).replace(/\.webp$/, ".ktx2"));
  zglosPliki(adresy);
  lmKtx2Obietnica = Promise.all(
    zaslepki.map((zas, i) =>
      new Promise<void>((ok) => {
        if (!ktx2Loader) return ok();
        ktx2Loader.load(
          adresy[i],
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.channel = 1;
            tex.flipY = false;
            tex.anisotropy = anizotropiaMax();
            tex.userData.url = zas.userData.url;
            tex.userData.ladowanie = true;
            for (const m of lightmapMats) if (m.lightMap === zas) m.lightMap = tex;
            lmCache.set(zas.userData.url as string, tex);
            zakonczPlik(adresy[i]);
            ok();
          },
          (e) => postepPliku(adresy[i], e.loaded, e.total),
          () => ok(),
        );
      }),
    ),
  ).then(() => undefined);
  return lmKtx2Obietnica;
}

/** NOWE_LADOWANIE: dekodowanie (w tle) lightmap jednego domu, gdy zostanie wybrany. */
function zaladujLightmapy(info: WnetrzeInfo) {
  const tekstury = new Set<THREE.Texture>();
  const zbierz = (m: THREE.Material | THREE.Material[]) => {
    for (const x of Array.isArray(m) ? m : [m]) {
      const lm = (x as THREE.MeshStandardMaterial).lightMap;
      if (lm?.userData.url && !lm.userData.ladowanie) tekstury.add(lm);
    }
  };
  info.root.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) zbierz(m); });
  for (const d of info.drzwi ?? []) for (const l of d.lm ?? []) zbierz(l.render);
  for (const tex of tekstury) {
    tex.userData.ladowanie = true;
    reg.lmOczekujace++;
    useStan.setState({ lmLaduja: reg.lmOczekujace });
    bitmapLoader.load(
      tex.userData.url as string,
      (bmp) => {
        tex.image = bmp;
        tex.needsUpdate = true;
        reg.lmOczekujace--;
        useStan.setState({ lmLaduja: reg.lmOczekujace });
        rig.invalidate();
      },
      undefined,
      () => { reg.lmOczekujace--; useStan.setState({ lmLaduja: reg.lmOczekujace }); },
    );
  }
}

function applyLightmap(root: THREE.Object3D, url: string, intensity: number) {
  const tex = lmTexture(url);
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.attributes.uv1) return;
    const one = (src: THREE.Material) => {
      const sm = src as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial || (src.name || "").toUpperCase().startsWith("SZYB")) return src;
      let c = clones.get(src) as THREE.MeshStandardMaterial | undefined;
      if (!c) {
        c = sm.clone();
        c.lightMap = tex;
        c.lightMapIntensity = intensity;
        c.userData.lmBase = intensity;
        c.envMapIntensity = 0.22;
        c.onBeforeCompile = (sh) => {
          const NL = String.fromCharCode(10);
          // ciepła korekta wypalonego światła (bake z niebieskim niebem HDRI, rendery dewelopera są ciepłe)
          sh.uniforms.uLmTint = { value: new THREE.Color(...(((window as unknown as { __lmTint?: [number, number, number] }).__lmTint) ?? LM_TINT)) };
          // światło z lightmapy zastępuje półkulę i światła bezpośrednie (słońce jest już wypalone)
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", ["#include <common>", "uniform vec3 uLmTint;"].join(NL))
            .replace("#include <lights_fragment_maps>", ["irradiance = vec3( 0.0 );", "#include <lights_fragment_maps>", "irradiance *= uLmTint;"].join(NL))
            .replace(
              "#include <lights_fragment_end>",
              ["#include <lights_fragment_end>", "reflectedLight.directDiffuse = vec3( 0.0 );", "reflectedLight.directSpecular = vec3( 0.0 );"].join(NL),
            );
        };
        c.customProgramCacheKey = () => "lm2";
        clones.set(src, c);
        lightmapMats.push(c);
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
    m.receiveShadow = false;
  });
}

function prepareInterior(src: THREE.Object3D, macierz: number[] | null, lightmapy?: Record<string, string>): WnetrzeInfo {
  const root = src.clone(true);
  // lightmapy: najpierw z manifestu (osobne dla domów lustrzanych), potem z extras węzłów
  root.traverse((o) => {
    const fromManifest = lightmapy?.[o.name];
    const fromExtras = o.userData?.lightMap as string | undefined;
    const url = fromManifest ?? fromExtras;
    if (url) applyLightmap(o, modelUrl(url), (o.userData?.lightMapIntensity as number) ?? 1);
  });
  if (macierz) {
    const m = new THREE.Matrix4().fromArray(macierz);
    const holder = new THREE.Group();
    holder.add(root);
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(m);
    holder.updateMatrixWorld(true);
    return collect(holder, lightmapy);
  }
  root.updateMatrixWorld(true);
  return collect(root, lightmapy);
}

const KOLEJNOSC = ["WEJSCIE", "HOL", "SALON", "JADALNIA", "KUCHNIA", "WC", "GARAZ", "SYPIALNIA", "POKOJ_DZIECKA", "POKOJ", "GABINET", "LAZIENKA"];

function collect(root: THREE.Object3D, lightmapy?: Record<string, string>): WnetrzeInfo {
  const info: WnetrzeInfo = { root, kadry: [], poziomy: {}, podlogi: [], punkty: [], kond: {}, sufity: {}, wierzchy: {} };
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (/^KADR_\d+$/.test(o.name)) {
      const ex = o.userData ?? {};
      const pos = o.getWorldPosition(new THREE.Vector3());
      // Object3D.getWorldDirection zwraca +Z; kamera patrzy w −Z
      const dir = o.getWorldDirection(new THREE.Vector3()).negate();
      const sp = Array.isArray(ex.spacer) ? new THREE.Vector3(...(ex.spacer as [number, number, number])).applyMatrix4(root.matrixWorld) : pos.clone();
      info.kadry.push({ id: o.name, ref: ex.ref ?? "", pokoj: ex.pokoj ?? "", etykieta: ex.etykieta ?? "", fov: ex.fov ?? 60, near: ex.near ?? 0.05, pos, dir, spacer: sp } satisfies Kadr);
    }
    const km = /^KOND_(\d+)$/.exec(o.name);
    if (km) {
      info.kond[+km[1]] = o;
      const w = o.userData?.wierzch as number | undefined;
      if (typeof w === "number") info.wierzchy![+km[1]] = o.localToWorld(new THREE.Vector3(0, w, 0)).y;
    }
    const sm = /^KOND_(\d+)__SUFIT/.exec(o.name);
    if (sm) (info.sufity[+sm[1]] ??= []).push(o);
    const pm = /^KOND_(\d+)__PODLOGA/.exec(o.name);
    if (pm) {
      o.traverse((x) => {
        if ((x as THREE.Mesh).isMesh) info.podlogi.push(x as THREE.Mesh);
      });
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty()) info.poziomy[+pm[1]] = b.max.y;
    }
    const pt = /^PKT_(\d+)_(.+)$/.exec(o.name);
    if (pt) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      const et = (o.userData?.etykieta as string) || pt[2].replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
      info.punkty.push({ id: o.name, etykieta: et, pos: [p.x, p.y, p.z], kond: +pt[1] } satisfies PunktSpaceru);
      // opcjonalny start spaceru dla punktu (oko i cel w układzie glTF wnętrza)
      const ex = o.userData ?? {};
      if (Array.isArray(ex.spacer) && Array.isArray(ex.cel)) {
        (info.startyPunktow ??= {})[o.name] = {
          pos: new THREE.Vector3(...(ex.spacer as [number, number, number])).applyMatrix4(root.matrixWorld),
          cel: new THREE.Vector3(...(ex.cel as [number, number, number])).applyMatrix4(root.matrixWorld),
        };
      }
    }
    // skrzydło drzwi: w GLB otwarte (spacer), extras.render = poza z renderów (kadry 1:1)
    if (/^DRZWI_/.test(o.name)) {
      const r = o.userData?.render;
      if (Array.isArray(r) && r.length === 4) {
        const d: NonNullable<WnetrzeInfo["drzwi"]>[number] = { obj: o, otwarte: o.quaternion.clone(), render: new THREE.Quaternion(...(r as [number, number, number, number])).normalize() };
        // druga lightmapa skrzydła (poza z renderów): GLB extras.lightMapRender, w domach lustrzanych manifest lightmapy["DRZWI_…#render"]
        const lmUrl = lightmapy?.[`${o.name}#render`] ?? (o.userData?.lightMapRender as string | undefined);
        if (lmUrl) {
          const tex = lmTexture(modelUrl(lmUrl));
          d.lm = [];
          o.traverse((x) => {
            const m = x as THREE.Mesh;
            if (!m.isMesh) return;
            const zRender = (src: THREE.Material) => {
              const sm = src as THREE.MeshStandardMaterial;
              if (!sm.lightMap) return src;
              const c = sm.clone();
              c.lightMap = tex;
              c.onBeforeCompile = sm.onBeforeCompile;
              c.customProgramCacheKey = sm.customProgramCacheKey;
              lightmapMats.push(c);
              return c;
            };
            d.lm!.push({ mesh: m, otwarte: m.material, render: Array.isArray(m.material) ? m.material.map(zRender) : zRender(m.material) });
          });
        }
        (info.drzwi ??= []).push(d);
      }
    }
    const mesh = o as THREE.Mesh;
    // wierzchy ścian (GLB od v19/v13): płaski kolor bez lightmapy, jasność wg pory dnia (przekroj.ts)
    if (mesh.isMesh && (/__WIERZCHY$/.test(o.name) || /__WIERZCHY$/.test(o.parent?.name ?? ""))) {
      mesh.material = WIERZCH_SCIANY;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      return;
    }
    if (mesh.isMesh) {
      if (NOWE_LADOWANIE) mesh.layers.enable(WARSTWA_WNETRZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const fix = (mat: THREE.Material) => ((mat.name || "").toUpperCase().startsWith("SZYB") ? szybaWnetrze(mat) : mat);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
    }
  });
  // kolejność jak w drodze przez dom (wejście → strefa dzienna → reszta), a nie alfabetyczna
  const rank = (id: string) => {
    const i = KOLEJNOSC.findIndex((k) => id.replace(/^PKT_\d+_/, "").startsWith(k));
    return i < 0 ? KOLEJNOSC.length : i;
  };
  info.punkty.sort((a, b) => (a.kond ?? 0) - (b.kond ?? 0) || rank(a.id) - rank(b.id));
  // poziom posadzki kondygnacji z punktów PKT (stoją na posadzce); ramka siatek PODLOGA bywała zawyżona
  // (progi, podesty), przez co pigułka pięter pokazywała „1” na parterze
  for (const pt of info.punkty) if (pt.kond !== undefined) info.poziomy[pt.kond] = pt.pos[1];
  info.przekroj = utworzPrzekroj(root);
  // druga poza skrzydeł drzwi (kadry 1:1) ma własne klony materiałów, poza siatkami: ta sama płaszczyzna cięcia
  for (const d of info.drzwi ?? []) for (const l of d.lm ?? []) for (const m of Array.isArray(l.render) ? l.render : [l.render]) m.clippingPlanes = [PLASZCZYZNA_WNETRZ];
  // lustra (materiał LUSTRO*): odbicie planarne w osobnej grupie w układzie świata
  const lustra: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => /^LUSTRO/i.test(x.name || ""))) lustra.push(m);
  });
  info.lustraGrupa = new THREE.Group();
  info.lustraGrupa.name = "LUSTRA";
  info.lustra = zbudujLustra(lustra, info.lustraGrupa);
  return info;
}

function HouseInterior({ id, file, macierz, lightmapy }: { id: DomId; file: string; macierz: number[] | null; lightmapy?: Record<string, string> }) {
  const gltf = useGLB(modelUrl(file));
  const info = useMemo(() => prepareInterior(gltf.scene, macierz, lightmapy), [gltf, macierz, lightmapy]);

  useEffect(() => {
    reg.wnetrza.set(id, info);
    useStan.getState().set({ wnetrzeGotowe: true });
    if (rig.kadrPending) {
      const ref = rig.kadrPending;
      setTimeout(() => rig.kadr(ref), 0);
    }
    const s = useStan.getState();
    if (s.widok === "dom" && s.dom === id) s.set({ punkty: info.punkty });
    return () => {
      reg.wnetrza.delete(id);
    };
  }, [id, info]);

  // widoczność kondygnacji i sufitów
  useEffect(() => {
    const apply = () => {
      const s = useStan.getState();
      const active = s.widok === "dom" && s.dom === id;
      if (NOWE_LADOWANIE && active) {
        // wszystkie domy są zamontowane na stałe: punkty i lightmapy bierzemy przy wyborze domu
        if (!LM_KTX2) zaladujLightmapy(info);
        if (s.punkty !== info.punkty) s.set({ punkty: info.punkty });
      }
      const inside = active && (s.kond !== "dom" || s.tryb === "spacer" || s.tryb === "rzut");
      info.root.visible = inside;
      const walk = s.tryb === "spacer";
      // Rzut: przekrój na 1,3 m nad posadzką wybranej kondygnacji, z zamkniętymi wierzchami ścian.
      // Model 3D kondygnacji: cięcie tuż nad wierzchami ścian tej kondygnacji (ściany klatki schodowej z grupy parteru
      // sięgały na piętro). Bryła domu z osiedla zostaje widoczna i jest cięta tą samą płaszczyzną: elewacja (tynk,
      // okna, oświetlenie pory dnia) zamiast białej skorupy wnętrza bez elewacji (zgłoszenie użytkownika 09.11, zrzut 2).
      const rzut = inside && s.tryb === "rzut";
      const lvl = s.kond === "dom" ? 0 : (s.kond as number);
      let h: number | null = null;
      if (inside && !walk) {
        const pos = info.poziomy[lvl] ?? 0;
        h = rzut ? pos + CIECIE_RZUTU : (info.wierzchy?.[lvl] ?? pos + WIERZCH_DOMYSLNY) + NAD_WIERZCHEM;
      }
      if (info.przekroj) h = ustawPrzekroj(info.przekroj, h, lvl, rzut);
      const shell = reg.domy.get(id);
      if (shell) {
        // w spacerze wewnątrz bryła znika (kamera w środku); w widokach z góry zostaje, przycięta
        shell.obj.visible = !inside || !walk;
        ustawSkorupe(shell, inside && !walk ? h : null);
      }
      if (!inside) return;
      const top = walk ? 99 : (s.kond as number);
      for (const [k, obj] of Object.entries(info.kond)) obj.visible = +k <= top;
      for (const [k, arr] of Object.entries(info.sufity)) for (const o of arr) o.visible = walk || +k < top;
    };
    apply();
    const unsub = useStan.subscribe(apply);
    return () => {
      unsub();
      const shell = reg.domy.get(id);
      if (shell) {
        shell.obj.visible = true;
        ustawSkorupe(shell, null);
      }
      if (info.przekroj) ustawPrzekroj(info.przekroj, null);
    };
  }, [id, info]);

  // lustra: widoczne razem z kondygnacją (sprawdzane co klatkę, tanie)
  useFrame(() => {
    if (info.lustra?.length) synchronizujLustra(info.lustra);
  });

  return (
    <>
      <primitive object={info.root} />
      {info.lustraGrupa && <primitive object={info.lustraGrupa} />}
    </>
  );
}

export function Interiors() {
  const man = useManifest();
  const dom = useStan((s) => s.dom);
  const widok = useStan((s) => s.widok);
  const cfg = widok === "dom" ? interiorFor(man, dom) : null;
  useEffect(() => {
    const has = !!cfg && !!dom && reg.wnetrza.has(dom);
    useStan.getState().set({ wnetrzeGotowe: cfg ? has : null });
  }, [dom, widok, !!cfg]);
  if (NOWE_LADOWANIE) {
    // wszystkie domy z wnętrzami zbudowane od razu (ukryte): wejście do domu to tylko zmiana widoczności
    const ids = Object.keys(man.domy ?? {}) as DomId[];
    return (
      <>
        {ids.map((id) => {
          const c = interiorFor(man, id);
          return c ? (
            <Suspense key={id} fallback={null}>
              <HouseInterior id={id} file={c.file} macierz={c.macierz} lightmapy={c.lightmapy} />
            </Suspense>
          ) : null;
        })}
      </>
    );
  }
  if (!cfg || !dom) return null;
  // własna granica Suspense: Interiors zatwierdza się od razu, więc wnetrzeGotowe = false przez cały czas
  // wczytywania (wcześniej było null i __ready / kamera uznawały dom za gotowy przed wczytaniem wnętrza)
  return (
    <Suspense fallback={null}>
      <HouseInterior key={dom} id={dom} file={cfg.file} macierz={cfg.macierz} lightmapy={cfg.lightmapy} />
    </Suspense>
  );
}
