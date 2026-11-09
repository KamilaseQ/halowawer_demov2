import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { suspend } from "suspend-react";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { useStan, type Pora } from "../state/store";
import { reg, useManifest, NOWE_LADOWANIE, postepPliku, zakonczPlik } from "./models";
import { WARSTWA_WNETRZ } from "./lustra";
import { lightmapMats } from "./Interiors";
import { jasnoscWierzchow } from "./przekroj";
import { sunPosition, KAT_PN } from "../lib/slonce";

/* Pory dnia (STANDARD_WIZUALNY §5):
   Dzień = późne popołudnie, słońce z SW, czytelna strona cienia, niebo z chmurami (b1, b3, b4, b6).
   Rano  = niskie słońce ze wschodu, chłodniej.
   Noc   = zmierzch „blue hour”: chłodne niebo, ciepłe okna, świecące kule ogrodowe (b2, b5). */

interface PoraCfg {
  hdr: string;
  /** kierunek DO słońca: azymut od północy zgodnie z zegarem (°), wysokość (°) */
  az: number;
  el: number;
  sun: string;
  sunI: number;
  envI: number;
  bgI: number;
  fog: string;
  okna: number;
  lampy: number;
  exposure: number;
  /** obrót HDRI wokół osi Y (rad), żeby jasna strona nieba zgadzała się ze słońcem */
  rot: number;
  /** ciepła półkula: odbicie od trawy rozjaśnia stronę cienia (b1, b3) */
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  /** korekcja koloru kopuły nieba (chmury z HDRI zostają): mnożnik, jasność, ciepłe pasmo przy horyzoncie */
  skyTint: string;
  skyI: number;
  horizon: string;
  horizonI: number;
  /** nasycenie nieba (referencje: blady błękit bielejący ku horyzontowi) */
  skySat: number;
  /** słońce studyjne: azymut słońca = azymut kamery + azOff (jak na renderach: elewacja zwrócona do kamery
      w słońcu, cień ukośny). null = stały azymut `az`. */
  azOff: number | null;
  /** szerokość bielejącego pasma przy horyzoncie (mniejsza liczba = szersze) */
  horizonW: number;
  /** chłodne wypełnienie od południa (zmierzch): siła, bez cieni */
  fillS?: number;
  /** chłodne światło nieba z góry (zmierzch): rozjaśnia grunt i łąkę, ścian pionowych nie */
  fillTop?: number;
  /** różowe podświetlenie jasnych chmur przy horyzoncie (zmierzch b2, b5) */
  cloudPink?: number;
  /** azymut słońca w HDRI (tools/hdr_slonce.py); niebo i odbicia obracamy, żeby słońce HDRI = słońce sceny */
  hdrAz: number;
}

/* Tryb słońca (decyzja klienta w toku, raport b7 iter04):
   - "studyjne": azymut = kierunek kamery + azOff (jak rendery dewelopera; fizycznie niemożliwe dla frontów od N),
   - "fizyczne" (domyślnie, najlepszy pomiar ΔE i prawdziwe strony świata): stały azymut `az` + ekspozycja na cień,
   - "hybryda": studyjne, ale przycięte do łuku możliwego w Polsce przy tej wysokości (105–255°).
   Adres: ?slonce=studyjne|fizyczne|hybryda */
export type TrybSlonca = "studyjne" | "fizyczne" | "hybryda";
export const slonce = {
  tryb: ((new URLSearchParams(location.search).get("slonce") as TrybSlonca) || "fizyczne") as TrybSlonca,
  luk: [105, 255] as [number, number],
};
(window as unknown as Record<string, unknown>).__slonce = slonce;

export const PORY: Record<Pora, PoraCfg> = (window as unknown as { __pory?: Record<Pora, PoraCfg> }).__pory = {
  rano: { hdr: "/env/qwantani_morning_puresky.hdr", az: 105, el: 16, sun: "#ffd2a6", sunI: 4.4, envI: 0.5, bgI: 1.0, fog: "#e3e0dc", okna: 0, lampy: 0, exposure: 1.0, rot: 0, hemiSky: "#f6e9da", hemiGround: "#bfae86", hemiI: 1.5, skyTint: "#f4f8ff", skyI: 1.5, horizon: "#ffe8d2", horizonI: 0.45, skySat: 0.95, azOff: 100, hdrAz: 126, horizonW: 3.2 },
  dzien: { hdr: "/env/dzien.hdr", az: 228, el: 33, sun: "#fff1dc", sunI: 5.6, envI: 0.6, bgI: 1.0, fog: "#d9e2ea", okna: 0, lampy: 0, exposure: 0.96, rot: 0, hemiSky: "#fff4e4", hemiGround: "#c9b98e", hemiI: 1.9, skyTint: "#e8f7ff", skyI: 1.55, horizon: "#ffffff", horizonI: 0.95, skySat: 1.0, azOff: 125, hdrAz: 124, horizonW: 2.6 },
  noc: { hdr: (new URLSearchParams(location.search).get("nochdr") ?? "/env/belfast_sunset_puresky.hdr"), az: 300, el: 4, sun: "#9fb1d6", sunI: 0.0, envI: 0.09, bgI: 0.42, fog: "#5b6290", okna: 2.2, lampy: 3.5, exposure: 1.0, rot: 0, hemiSky: "#9fa5c4", hemiGround: "#3a3b38", hemiI: 1.0, skyTint: "#7d8fd6", skyI: 0.9, horizon: "#e2a9b4", horizonI: 0.55, skySat: 0.8, azOff: null, hdrAz: 128, horizonW: 9, fillS: 1.6, fillTop: 2.5, cloudPink: 1.6 },
};

const rgbe = new HDRLoader();
function useHdr(url: string) {
  return suspend(async () => {
    const t = await rgbe.loadAsync(url, NOWE_LADOWANIE ? (e: ProgressEvent) => postepPliku(url, e.loaded, e.total) : undefined);
    if (NOWE_LADOWANIE) zakonczPlik(url);
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }, ["hdr", url]);
}

function dirFrom(az: number, el: number) {
  // układ: X = wschód, Z = południe, Y = góra; azymut od północy (−Z) w stronę wschodu (+X)
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

export function Lighting() {
  const pora = useStan((s) => s.pora);
  const { scene, gl, invalidate } = useThree();
  // na start tylko niebo bieżącej pory (suspend); pozostałe doładowują się w tle po pokazaniu sceny
  const startPora = useRef<Pora>(useStan.getState().naslonecznienie ? "dzien" : useStan.getState().pora).current;
  const startTex = useHdr(PORY[startPora].hdr);
  // NOWE_LADOWANIE: wszystkie trzy pory za ekranem ładowania (przełączenie pory bez doczytywania w trakcie oglądania)
  const wszystkie = NOWE_LADOWANIE ? (["dzien", "rano", "noc"] as Pora[]).map((p) => [p, useHdr(PORY[p].hdr)] as const) : [];
  const [tex, setTex] = useState<Partial<Record<Pora, THREE.Texture>>>(() => (NOWE_LADOWANIE ? Object.fromEntries(wszystkie) : { [startPora]: startTex }));
  useEffect(() => {
    if (NOWE_LADOWANIE) return;
    const t = setTimeout(() => {
      for (const p of ["dzien", "rano", "noc"] as Pora[]) {
        if (p === startPora) continue;
        rgbe.loadAsync(PORY[p].hdr).then((x) => {
          x.mapping = THREE.EquirectangularReflectionMapping;
          setTex((cur) => ({ ...cur, [p]: x }));
        });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const top = useRef<THREE.DirectionalLight>(null);
  // światła także dla kamery odbicia luster (warstwa wnętrza): bez tego odbite elewacje miały tylko światło otoczenia
  // (wnętrza z lightmapą i tak ignorują światło bezpośrednie)
  useEffect(() => {
    if (!NOWE_LADOWANIE) return;
    for (const l of [sun.current, hemi.current, fill.current, top.current]) l?.layers.enable(WARSTWA_WNETRZ);
  }, []);
  const sunAz = useRef(PORY[pora].az);
  const cur = useRef<{ sunI: number; envI: number; okna: number; lampy: number; dir: THREE.Vector3; col: THREE.Color; fog: THREE.Color; exp: number; hemi?: number }>({ sunI: PORY[pora].sunI, envI: PORY[pora].envI, okna: PORY[pora].okna, lampy: PORY[pora].lampy, dir: dirFrom(PORY[pora].az, PORY[pora].el), col: new THREE.Color(PORY[pora].sun), fog: new THREE.Color(PORY[pora].fog), exp: PORY[pora].exposure });

  const dome = useMemo(() => skyDomeMaterial(), []);
  // środek osiedla i zasięg cieni
  const center = useMemo(() => reg.osiedleBox.getCenter(new THREE.Vector3()), []);

  const nasl = useStan((s) => s.naslonecznienie);
  useEffect(() => {
    const c = PORY[nasl ? "dzien" : pora];
    scene.background = null;
    // do czasu doładowania nieba danej pory zostaje poprzednie (światło i tak przechodzi płynnie)
    const want = tex[nasl ? "dzien" : pora];
    if (want) {
      dome.uniforms.map.value = want;
      scene.environment = want;
    }
    scene.environmentRotation.set(0, c.rot, 0);
    if (!scene.fog) scene.fog = new THREE.Fog(c.fog, 180, 1300);
    invalidate();
  }, [pora, nasl, tex]);

  useFrame(({ camera }, dt) => {
    const st = useStan.getState();
    const c = st.naslonecznienie ? naslCfg(st.miesiac, st.godzina) : PORY[st.pora];
    const f = camera.getWorldDirection(new THREE.Vector3());
    const k = 1 - Math.exp(-dt * 3.5);
    const s = cur.current;
    let moving = false;
    const lerp = (a: number, b: number) => {
      const v = a + (b - a) * k;
      if (Math.abs(b - v) > 1e-3) moving = true;
      return Math.abs(b - v) < 1e-3 ? b : v;
    };
    s.sunI = lerp(s.sunI, c.sunI);
    s.envI = lerp(s.envI, c.envI);
    s.okna = lerp(s.okna, c.okna);
    s.lampy = lerp(s.lampy, c.lampy);
    // „ekspozycja na cień”: gdy patrzymy pod słońce (elewacje do kamery w cieniu), aparat doświetla cień
    const sunH = new THREE.Vector2(s.dir.x, s.dir.z).normalize();
    const camH = new THREE.Vector2(f.x, f.z).normalize();
    const pod = THREE.MathUtils.clamp(sunH.dot(camH), 0, 1) * (c.azOff !== null && !st.naslonecznienie ? 1 : 0);
    // wypełnienie cienia przy patrzeniu pod słońce (bez zmiany ekspozycji, żeby nie prześwietlać powierzchni w słońcu)
    const ek = (window as unknown as { __ek?: [number, number] }).__ek ?? [0, 0.9];
    s.exp = lerp(s.exp, c.exposure * (1 + ek[0] * pod));
    s.hemi = lerp(s.hemi ?? c.hemiI, c.hemiI * (1 + ek[1] * pod));
    // azymut słońca: stały albo „studyjny” (podąża łagodnie za kamerą)
    let wantAz = c.az;
    const camAz = THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z));
    if (c.azOff !== null && slonce.tryb !== "fizyczne" && !st.naslonecznienie) {
      wantAz = (((camAz + c.azOff) % 360) + 360) % 360;
      if (slonce.tryb === "hybryda") {
        // przycięcie do łuku możliwego w Polsce (bliższy koniec łuku, gdy poza nim)
        const [a0, a1] = slonce.luk;
        if (wantAz < a0 || wantAz > a1) {
          const d0 = Math.abs(((wantAz - a0 + 540) % 360) - 180);
          const d1 = Math.abs(((wantAz - a1 + 540) % 360) - 180);
          wantAz = d0 < d1 ? a0 : a1;
        }
      }
    }
    let dAz = ((wantAz - sunAz.current + 540) % 360) - 180;
    if (Math.abs(dAz) > 0.05) {
      sunAz.current += dAz * (1 - Math.exp(-dt * 1.4));
      moving = true;
    }
    const target = dirFrom(sunAz.current, c.el);
    if (s.dir.distanceTo(target) > 1e-4) { s.dir.lerp(target, Math.max(k, 0.5)).normalize(); moving = true; }
    // obrót nieba i odbić: słońce w HDRI ląduje w azymucie słońca sceny
    const rotY = THREE.MathUtils.degToRad(sunAz.current - c.hdrAz);
    scene.environmentRotation.set(0, rotY, 0);
    dome.uniforms.rotY.value = rotY;
    const tc = new THREE.Color(c.sun);
    s.col.lerp(tc, k);
    s.fog.lerp(new THREE.Color(c.fog), k);
    if (sun.current) {
      sun.current.intensity = s.sunI;
      sun.current.color.copy(s.col);
      sun.current.position.copy(center).addScaledVector(s.dir, 160);
      sun.current.target.position.copy(center);
      sun.current.target.updateMatrixWorld();
    }
    scene.environmentIntensity = s.envI;
    {
      const u = dome.uniforms;
      u.tint.value.lerp(new THREE.Color(c.skyTint), k);
      u.intensity.value += (c.skyI - u.intensity.value) * k;
      u.horizon.value.lerp(new THREE.Color(c.horizon), k);
      u.horizonI.value += (c.horizonI - u.horizonI.value) * k;
      u.sat.value += (c.skySat - u.sat.value) * k;
      u.horizonW.value += (c.horizonW - u.horizonW.value) * k;
      u.cloudPink.value += ((c.cloudPink ?? 0) - u.cloudPink.value) * k;
      u.fogColor.value.copy(s.fog);
      if (Math.abs(c.skyI - u.intensity.value) > 1e-3) moving = true;
    }
    if (fill.current) {
      const want = c.fillS ?? 0;
      fill.current.intensity += (want - fill.current.intensity) * k;
      const fp = (window as unknown as { __fillPos?: [number, number, number] }).__fillPos ?? [0, 85, 60];
      fill.current.position.copy(center).add(new THREE.Vector3(...fp));
      fill.current.target.position.copy(center);
      fill.current.target.updateMatrixWorld();
    }
    if (top.current) {
      const want = (window as unknown as { __top?: number }).__top ?? c.fillTop ?? 0;
      top.current.intensity += (want - top.current.intensity) * k;
      top.current.position.copy(center).add(new THREE.Vector3(0.5, 100, 0.5));
      top.current.target.position.copy(center);
      top.current.target.updateMatrixWorld();
    }
    if (hemi.current) {
      hemi.current.intensity = s.hemi ?? c.hemiI;
      hemi.current.color.lerp(new THREE.Color(c.hemiSky), k);
      hemi.current.groundColor.lerp(new THREE.Color(c.hemiGround), k);
    }
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(s.fog);
    gl.toneMappingExposure = s.exp;
    for (const m of reg.szyby) m.emissiveIntensity = s.okna * 0.7 * ((m.userData.oknaK as number) ?? 1);
    for (const m of reg.lampy) m.emissiveIntensity = s.lampy;
    // Światło dnia we wnętrzu: lightmapy są wypalone w dzień, więc w nasłonecznieniu przygasają razem z niebem
    // (naslCfg: hemiI = dzień × sky, sky 0,2…1 wg wysokości słońca); wcześniej było stałe 1 i przy niskim słońcu
    // albo po zmroku wnętrze świeciło na tle ciemnego osiedla (zgłoszenie użytkownika 09.11).
    const dzienK = st.naslonecznienie ? Math.min(1, c.hemiI / PORY.dzien.hemiI) : st.pora === "noc" ? 0 : st.pora === "rano" ? 0.85 : 1;
    const lmK = Math.max(0.22, dzienK);
    // wierzchy ścian (płaski kolor bez lightmapy): jak powierzchnia na zewnątrz, w nocy ciemne
    const wK = (window as unknown as { __wK?: number }).__wK ?? 0.12 + 0.88 * dzienK;
    if (jasnoscWierzchow(wK)) invalidate();
    const lmDbg = window as unknown as { __lmEnv?: number; __lmK?: number };
    for (const m of lightmapMats) {
      m.lightMapIntensity = (m.userData.lmBase ?? 1) * lmK * (lmDbg.__lmK ?? 1);
      // three r187: przy envMap === null renderer bierze scene.environmentIntensity i ignoruje envMapIntensity
      // (WebGLRenderer ok. l. 2747). Wnętrza z lightmapą dostają więc własną envMap = otoczenie sceny,
      // żeby działało słabe 0,22 (GI jest już wypalone). Zewnętrza celowo nie zmieniamy (odebrane w tym stanie).
      if (scene.environment && m.envMap !== scene.environment) {
        m.envMap = scene.environment;
        m.needsUpdate = true;
      }
      m.envMapRotation.copy(scene.environmentRotation);
      m.envMapIntensity = lmDbg.__lmEnv ?? LM_ENV;
    }
    if (moving) {
      invalidate();
      reg.odswiezCienie();
    }
  });

  return (
    <>
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.00025}
        shadow-radius={3}
        shadow-blurSamples={12}
        shadow-normalBias={0.035}
        shadow-camera-left={-105}
        shadow-camera-right={105}
        shadow-camera-top={105}
        shadow-camera-bottom={-105}
        shadow-camera-near={10}
        shadow-camera-far={420}
      />
      <SkyDome material={dome} />
      <directionalLight ref={fill} color="#c9bfbd" intensity={0} />
      <directionalLight ref={top} color="#9eaee8" intensity={0} />
      <hemisphereLight ref={hemi} args={[PORY[pora].hemiSky, PORY[pora].hemiGround, PORY[pora].hemiI]} />
      <OuterGround />
    </>
  );
}

/** Łąka poza modelem SKP aż po horyzont (żeby makieta nie wisiała w niebie). */
function OuterGround() {
  const okolica = !!useManifest().okolica;
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#7f8c58", roughness: 1, metalness: 0 });
    return m;
  }, []);
  const c = reg.osiedleBox.getCenter(new THREE.Vector3());
  if (okolica) return null;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[c.x, reg.osiedleBox.min.y + 0.55, c.z]} receiveShadow material={mat}>
      <circleGeometry args={[2200, 64]} />
    </mesh>
  );
}

/* Kopuła nieba: HDRI equirect z korekcją koloru (zmierzch b2/b5: chłodny błękit, różowe chmury przy horyzoncie). */
function skyDomeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      map: { value: null as THREE.Texture | null },
      tint: { value: new THREE.Color("#ffffff") },
      intensity: { value: 1 },
      horizon: { value: new THREE.Color("#ffffff") },
      horizonI: { value: 0 },
      sat: { value: 1 },
      fogColor: { value: new THREE.Color("#d9e2ea") },
      rotY: { value: 0 },
      horizonW: { value: 9 },
      cloudPink: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 tint; uniform float intensity; uniform vec3 horizon; uniform float horizonI; uniform float sat; uniform vec3 fogColor; uniform float rotY; uniform float horizonW; uniform float cloudPink;
      varying vec3 vDir;
      void main() {
        vec3 d0 = normalize(vDir);
        float cr = cos(rotY), sr = sin(rotY);
        vec3 d = vec3(d0.x * cr + d0.z * sr, d0.y, -d0.x * sr + d0.z * cr);
        vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec3 c = texture2D(map, uv).rgb * tint * intensity;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, sat);
        // jasne partie chmur w dolnej części nieba nabierają różu zachodu
        float cl = smoothstep(0.22, 0.7, l / max(intensity, 1e-3)) * exp(-max(d.y, 0.0) * 2.2);
        c = mix(c, c * vec3(1.45, 0.9, 1.0), clamp(cl * cloudPink, 0.0, 1.0));
        float h = exp(-max(d.y, 0.0) * horizonW);
        c = mix(c, c + horizon * 0.6, h * horizonI);
        // przy horyzoncie niebo przechodzi w kolor mgły, więc daleki grunt i niebo stykają się bez krawędzi
        c = mix(c, fogColor, smoothstep(0.06, -0.01, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function SkyDome({ material }: { material: THREE.ShaderMaterial }) {
  const ref = useRef<THREE.Mesh>(null);
  // niebo także w odbiciu luster (kamera odbicia widzi tylko warstwę wnętrza): okno w lustrze pokazuje niebo,
  // a nie ciemne tło (b7 iter32, łazienka B)
  useEffect(() => {
    if (NOWE_LADOWANIE) ref.current?.layers.enable(WARSTWA_WNETRZ);
  }, []);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[100, 48, 24]} />
    </mesh>
  );
}

/** odbicia otoczenia na powierzchniach z lightmapą (GI jest już wypalone, więc tylko połysk) */
export const LM_ENV = 0.22;

/* Konfiguracja światła w trybie Nasłonecznienie: słońce z kalkulatora (NOAA), barwa i siła zależne od wysokości. */
const naslCache = { key: "", cfg: null as PoraCfg | null };
function naslCfg(miesiac: number, godzina: number): PoraCfg {
  const key = `${miesiac}|${godzina}`;
  if (naslCache.key === key && naslCache.cfg) return naslCache.cfg;
  const p = sunPosition(miesiac, godzina);
  const az = p.az - KAT_PN; // azymut geograficzny → azymut w układzie modelu
  const el = p.el;
  const d = PORY.dzien;
  const e = Math.max(el, -2);
  const t = THREE.MathUtils.smoothstep(e, 0, 30); // 0 przy horyzoncie, 1 wysoko
  const sun = new THREE.Color("#ff9a5c").lerp(new THREE.Color("#fff3e2"), THREE.MathUtils.smoothstep(e, 2, 25));
  // Fizyka czystego nieba: rozproszone światło nieba maleje z wysokością słońca (≈ sin el), więc zimą cienie
  // są głębokie i długie. Ogólny poziom wyrównuje ekspozycja (jak aparat), stosunek słońce : niebo zostaje.
  const sinRel = Math.max(0, Math.sin(THREE.MathUtils.degToRad(Math.max(e, 0)))) / Math.sin(THREE.MathUtils.degToRad(33));
  const sky = 0.2 + 0.8 * Math.min(1, sinRel);
  const cfg: PoraCfg = {
    ...d,
    az,
    el: Math.max(e, 0.5),
    azOff: null,
    sun: "#" + sun.getHexString(),
    sunI: d.sunI * THREE.MathUtils.smoothstep(e, -1, 8),
    hemiI: d.hemiI * sky,
    envI: d.envI * sky,
    skyI: d.skyI * (0.45 + 0.55 * THREE.MathUtils.smoothstep(e, -2, 15)),
    exposure: d.exposure * (1 + 0.35 * (1 - Math.min(1, sinRel))),
    horizon: e < 8 ? "#ffc9a0" : d.horizon,
    horizonI: e < 8 ? 0.8 : d.horizonI,
  };
  naslCache.key = key;
  naslCache.cfg = cfg;
  return cfg;
}
