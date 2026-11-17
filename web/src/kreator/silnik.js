/* Kreator wnętrza: mieszkanie 3D z wypalonym światłem, w którym klient zmienia wykończenie (gotowy styl albo każdy
   materiał osobno), ogląda je z góry (makieta) albo chodzi po nim (spacer). Przeniesiony 1:1 z samodzielnej strony
   kreatora; zmiany: three z aplikacji zamiast CDN, wszystko zamknięte w jednym kontenerze, wygląd spójny z makietą
   osiedla, zwalnianie pamięci GPU przy zamknięciu (zniszcz()).

   uruchomKreator(root, { onZamknij, etykietaPowrotu, mobilne }) → { zniszcz } */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import MM from "./materialy.json";
import { OBJMAT, ALIAS, FLOORMATS, GROUPS, PAINTS, FLOORS, STYLES, ROOMS, MODEL, EYE, CLAY } from "./dane.js";

const BAZA = "/kreator/";
const ROZMIAR_GLB = 11931716; // bajty apartment.glb (postęp, gdy serwer nie poda długości)
const KEY = "kreator-wnetrza-v3";
const TLO_MAKIETY = "#d8d3ca";
const BLYSK = "#e8cf8a"; // podświetlenie klikniętego elementu (ten sam złoty co obrys domu na makiecie)

const IKONA_WSTECZ = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M19 12H5.5M11 6l-6 6 6 6"/></svg>';

const SZKIELET = `
<div class="kr-app">
  <div class="kr-stage">
    <canvas id="kr-view" tabindex="0" aria-label="Podgląd 3D mieszkania"></canvas>
    <div class="kr-views" id="kr-views"></div>
    <div class="kr-joy" id="kr-joy" hidden><i id="kr-knob"></i></div>
    <div class="kr-hint" id="kr-hint"></div>
    <div class="kr-loader" id="kr-loader">
      <div class="kr-loadcard">
        <b id="kr-loadtitle">Wczytuję mieszkanie…</b>
        <div class="kr-bar"><i id="kr-prog"></i></div>
        <span class="kr-loadmb" id="kr-loadmb">…</span>
        <p class="kr-note" id="kr-loadnote">Model 3D, tekstury i wypalone światło</p>
      </div>
    </div>
  </div>
  <aside class="kr-panel" id="kr-panel">
    <header>
      <span class="kr-kicker">Wykończ mieszkanie pod siebie</span>
      <h1>Kreator wnętrza</h1>
      <p class="kr-sub">Przejdź się po mieszkaniu i zmieniaj wystrój: gotowy styl albo każdy materiał osobno.</p>
    </header>
    <section id="kr-pickedBox" hidden>
      <div class="kr-picked">
        <p><b id="kr-pickedName">Wybrany element</b></p>
        <div class="kr-sw" id="kr-sw-picked"></div>
      </div>
    </section>
    <section><h2>Styl</h2><div class="kr-styles" id="kr-styles"></div></section>
    <section><h2>Podłoga <span id="kr-n-floor"></span></h2><div class="kr-mats" id="kr-mats-floor"></div><div class="kr-sw" id="kr-sw-floor"></div></section>
    <div id="kr-groups" style="display:contents"></div>
    <section><div class="kr-row"><button class="kr-btn" id="kr-reset">Przywróć oryginał</button></div>
      <p class="kr-note" style="margin-top:10px">Ustawienia zapisują się w tej przeglądarce.</p></section>
  </aside>
</div>`;

export function uruchomKreator(root, opts = {}) {
  const onZamknij = opts.onZamknij || (() => {});
  const etykietaPowrotu = opts.etykietaPowrotu || "Wróć";
  root.innerHTML = SZKIELET;
  const $ = (s) => root.querySelector(s);
  let zyje = true;
  const sprzatanie = [];
  const on = (t, ev, fn, o) => {
    t.addEventListener(ev, fn, o);
    sprzatanie.push(() => t.removeEventListener(ev, fn, o));
  };
  const ac = new AbortController();

  /* ---------- stan ---------- */
  let state = {};
  function applyStyleToState(s) {
    state = { light: state.light || "eve", style: s.id, floor: s.floor, tint: s.tint, floorAll: s.all !== false, colors: {}, custom: {} };
    for (const g of GROUPS) state.colors[g.id] = s[g.id] || null;
  }
  applyStyleToState(STYLES[0]);
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.colors && s.floor) state = Object.assign(state, s);
  } catch (e) {}
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  };

  /* ---------- renderer ---------- */
  const canvas = $("#kr-view");
  const small = !!opts.mobilne || Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: new URLSearchParams(location.search).has("shot") });
  const BASE_DPR = Math.min(devicePixelRatio || 1, opts.mobilne ? 1.25 : 1.5);
  renderer.setPixelRatio(BASE_DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap usunięty w three r187
  const scene = new THREE.Scene();
  let dirty = true, mode = "model";
  let moving = false, lastMove = 0;

  /* wypalone światło wieczoru: lightmapa z path tracingu dla ścian, podłóg i zabudowy, sondy światła dla mebli */
  const BAKE_RANGE = 4, BAKE_EXPO = 2.2, BLANK = [0.048828125, 0.021484375];
  const PN = [44, 30, 11]; // sondy światła: siatka 25 cm, sześć kierunków
  const probeTex = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  probeTex.needsUpdate = true;
  const U = { uBakeK: { value: 0 }, uIbl: { value: 1 }, uProbe: { value: probeTex } };
  {
    const im = new Image();
    im.onload = () => {
      if (!zyje) return;
      const c = document.createElement("canvas");
      c.width = im.width; c.height = im.height;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, im.width, im.height).data;
      const t = new THREE.Data3DTexture(new Uint8Array(d.buffer), PN[0] * 6, PN[1], PN[2]);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
      U.uProbe.value = t; dirty = true; queueEnv();
    };
    im.src = BAZA + "tex/probes.png";
  }
  const isEve = () => state.light !== "day";
  const duskTex = (() => {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 256;
    const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#16223f"); g.addColorStop(0.36, "#3f5078"); g.addColorStop(0.47, "#c98f72"); g.addColorStop(0.5, "#f2b27a"); g.addColorStop(0.53, "#4a4038"); g.addColorStop(1, "#1c1a18");
    x.fillStyle = g; x.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ map: duskTex, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.visible = false;
  function themeBg() {
    scene.background = new THREE.Color(mode === "walk" ? (isEve() ? "#1c2740" : "#e4ecf1") : TLO_MAKIETY);
    sky.visible = mode === "walk" && isEve();
    if (!sky.parent) scene.add(sky);
    dirty = true;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envDay = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envDay;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.minDistance = 3; controls.maxDistance = 26; controls.maxPolarAngle = 1.42;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b2a8, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.position.set(-7.5, 7, -7.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.autoUpdate = false; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  scene.add(sun);
  const lamps = [[-1.8, -1.4], [1.9, -1.2], [-1.8, 2.1], [2.1, 2.4], [-4.5, 1.5]].map(([x, z]) => {
    const l = new THREE.PointLight(0xffe3c2, 0, 7.5, 1.6);
    l.position.set(x, 2.25, z);
    scene.add(l);
    return l;
  });

  /* lampa podłogowa w salonie: jej światło jest częścią wypalonego wieczoru */
  const lampGlow = new THREE.MeshStandardMaterial({ color: "#f4efe6", emissive: "#ffcf96", emissiveIntensity: 0.15, roughness: 0.6 });
  const lampDark = new THREE.MeshStandardMaterial({ color: "#1b1b1c", roughness: 0.4, metalness: 0.6 });
  const lampGeo = [new THREE.CylinderGeometry(0.011, 0.011, 1.32, 12), new THREE.CylinderGeometry(0.13, 0.13, 0.015, 32), new THREE.SphereGeometry(0.14, 32, 20)];
  {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(lampGeo[0], lampDark); pole.position.y = 0.66;
    const base = new THREE.Mesh(lampGeo[1], lampDark); base.position.y = 0.008;
    const globe = new THREE.Mesh(lampGeo[2], lampGlow); globe.position.y = 1.45;
    g.add(pole, base, globe);
    g.position.set(-3.72, 0, -1.55);
    scene.add(g);
  }
  let composer = null, gtao = null, bloom = null;
  const maxSamples = opts.mobilne ? 2 : 4;
  try {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.2, samples: 8, screenSpaceRadius: false });
    gtao.blendIntensity = 0.55;
    composer.addPass(gtao);
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.55, 1.25);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch (e) {
    composer = null;
  }
  themeBg();
  function setFov() {
    const p = camera.aspect < 1;
    camera.fov = mode === "walk" ? (p ? 84 : 68) : (p ? 58 : 42);
    camera.updateProjectionMatrix();
  }
  /* rozdzielczość dynamiczna: w ruchu klatka w niższej rozdzielczości dobranej z czasu klatki,
     w spoczynku wraca pełna; cienie i światło bez zmian */
  let resScale = 1, motionScale = 1, lastResChange = 0;
  function applyRes(sc) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    resScale = sc; lastResChange = performance.now();
    const pr = BASE_DPR * sc;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (composer) {
      const ms = sc >= 1 ? maxSamples : 2;
      for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== ms) { t.samples = ms; t.dispose(); } // pełny antyaliasing w spoczynku
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      if (gtao) gtao.setSize(Math.ceil((w * pr) / 2), Math.ceil((h * pr) / 2)); // miękkie cienie kontaktowe wystarczą w połowie rozdzielczości
    }
    dirty = true;
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    setFov();
    applyRes(resScale);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* widok makiety: sufit i ściany najbliżej kamery są odcięte */
  const P = (nx, ny, nz, c) => new THREE.Plane(new THREE.Vector3(nx, ny, nz), c);
  const clipTop = P(0, -1, 0, 2.42), clipXp = P(-1, 0, 0, 5.14), clipXn = P(1, 0, 0, 5.22), clipZn = P(0, 0, 1, 3.04), clipZp = P(0, 0, -1, 3.44), clipHall = P(0, 0, -1, 3.72);
  function updateClip() {
    if (mode === "walk") { renderer.clippingPlanes = []; return; }
    const c = camera.position, pl = [clipTop];
    if (c.x > 5.1) pl.push(clipXp);
    if (c.x < -5.2) pl.push(clipXn);
    if (c.z < -3.1) pl.push(clipZn);
    pl.push(c.z > 3.4 ? clipZp : clipHall);
    renderer.clippingPlanes = pl;
  }

  /* ---------- tekstury ---------- */
  const texLoader = new THREE.TextureLoader(), texBase = {}, texVar = {};
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // telefon: skany materiałów maks. 512 px (tex/m/, ok. 33 zamiast 140 MB pamięci GPU), jak wnętrza makiety
  const TEX_SKANOW = BAZA + (opts.mobilne ? "tex/m/" : "tex/");
  function srcTex(name, sx = 1, sy = 1) { // oryginalne skany, UV i powtarzanie ze sceny źródłowej
    const k = name + "|" + sx + "|" + sy;
    if (texVar[k]) return texVar[k];
    let b = texBase[name];
    if (!b) {
      b = texBase[name] = texLoader.load(TEX_SKANOW + name + ".jpg", () => {
        dirty = true;
        for (const kk in texVar) if (kk.startsWith(name + "|")) texVar[kk].needsUpdate = true;
      });
      b.flipY = false; b.colorSpace = THREE.SRGBColorSpace; b.wrapS = b.wrapT = THREE.RepeatWrapping; b.anisotropy = aniso;
    }
    const t = sx === 1 && sy === 1 ? b : b.clone();
    // clone() oznacza kopię do wysłania na GPU; przed wczytaniem skanu nie ma czego wysłać (ostrzeżenie three),
    // więc licznik wraca do zera, a po wczytaniu onLoad wyżej oznacza kopię ponownie
    if (t !== b && !b.image) t.version = 0;
    t.repeat.set(sx, sy);
    t.offset.set(0.5 - 0.5 * sx, 0.5 - 0.5 * sy);
    return (texVar[k] = t);
  }
  const LM = texLoader.load(BAZA + "tex/lightmap.jpg", () => { dirty = true; queueEnv(); });
  LM.flipY = false; LM.colorSpace = THREE.SRGBColorSpace; LM.channel = 2; LM.generateMipmaps = false; LM.minFilter = THREE.LinearFilter;
  const imgs = {};
  const loadImg = (n) => new Promise((r) => {
    const i = new Image();
    i.onload = () => r((imgs[n] = i));
    i.onerror = () => r(null);
    i.src = BAZA + "tex/" + n + ".jpg";
  });
  function rnd(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  function drawPiece(ctx, img, x, y, w, h, r, alongX) { // jedna deska z losowego wycinka; słoje skanów biegną pionowo
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (img) {
      const iw = img.width, ih = img.height;
      if (alongX) {
        const sw = Math.min(iw * 0.5, ((iw * h) / w) * 2.2), sh = ih * 0.9, sx = r() * (iw - sw), sy = r() * (ih - sh);
        ctx.translate(x, y + h); ctx.rotate(-Math.PI / 2); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, h, w);
      } else {
        const sw = Math.min(iw * 0.5, ((iw * w) / h) * 2.2), sh = ih * 0.9, sx = r() * (iw - sw), sy = r() * (ih - sh);
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      }
    } else {
      ctx.fillStyle = "#b9a07c"; ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    const v = r() - 0.5;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.16})` : `rgba(0,0,0,${-v * 0.2})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(30,20,10,.33)"; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function floorCanvas(type, S) {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d"), r = rnd(7);
    const wood = { plank: "oak", herring: "oak", herringw: "walnut", ash: "ash", walnut: "walnut" }[type];
    if (type === "herring" || type === "herringw") {
      const n = 5, cell = S / (2 * n), img = imgs[wood];
      for (let k = -2 * n; k < 4 * n; k++) for (let m = -2; m < 3; m++) {
        const hx = (k + 2 * n * m) * cell, hy = k * cell, vx = (k + n + 2 * n * m) * cell, vy = (k - n + 1) * cell, q = (((k % (2 * n)) + 2 * n) % (2 * n));
        for (const oy of [0, -S, S]) {
          drawPiece(ctx, img, hx, hy + oy, n * cell, cell, rnd(1000 + q), true);
          drawPiece(ctx, img, vx, vy + oy, cell, n * cell, rnd(2000 + q), false);
        }
      }
      return { c, m: 0.9, rot: Math.PI / 4 };
    }
    if (wood) {
      const rows = 12, h = S / rows, L = S / 2;
      for (let j = 0; j < rows; j++) {
        const off = -r() * L;
        for (let i = 0; i < 4; i++) drawPiece(ctx, imgs[wood], off + i * L, j * h, L, h, rnd(31 + j * 7 + (i % 2)), true);
      }
      return { c, m: 2.4, rot: 0 };
    }
    if (type === "marble") {
      const img = imgs.marble;
      for (let i = 0; i < 2; i++) {
        ctx.save();
        if (i) { ctx.translate(S, 0); ctx.scale(-1, 1); }
        if (img) ctx.drawImage(img, 0, 0, S / 2, S);
        else { ctx.fillStyle = "#e8e6e2"; ctx.fillRect(0, 0, S / 2, S); }
        ctx.restore();
        ctx.strokeStyle = "rgba(60,60,60,.3)"; ctx.lineWidth = 1.5; ctx.strokeRect((i * S) / 2 + 0.5, 0.5, S / 2 - 1, S - 1);
      }
      return { c, m: 2.4, rot: 0 };
    }
    if (type === "marble2") {
      const img = imgs.marble2;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        if (i % 2) { ctx.translate(((2 * i + 1) * S) / 3, 0); ctx.scale(-1, 1); }
        if (img) ctx.drawImage(img, i % 2 ? 0 : (i * S) / 3, 0, S / 3, S);
        else { ctx.fillStyle = "#efeeea"; ctx.fillRect((i * S) / 3, 0, S / 3, S); }
        ctx.restore();
        ctx.strokeStyle = "rgba(60,60,60,.28)"; ctx.lineWidth = 1.5; ctx.strokeRect((i * S) / 3 + 0.5, 0.5, S / 3 - 1, S - 1);
      }
      return { c, m: 2.4, rot: 0 };
    }
    if (type === "tile") {
      ctx.fillStyle = "#8b8a86"; ctx.fillRect(0, 0, S, S);
      const g = 3;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const img = imgs[(i + j) % 2 ? "tile" : "tile2"], x = (i * S) / 4, y = (j * S) / 2;
        if (img) ctx.drawImage(img, x + g / 2, y + g / 2, S / 4 - g, S / 2 - g);
        else { ctx.fillStyle = "#c4c2bd"; ctx.fillRect(x + g / 2, y + g / 2, S / 4 - g, S / 2 - g); }
      }
      return { c, m: 2.4, rot: 0 };
    }
    if (imgs.concrete) ctx.drawImage(imgs.concrete, 0, 0, S, S);
    else { ctx.fillStyle = "#9b9a96"; ctx.fillRect(0, 0, S, S); }
    return { c, m: 3.2, rot: 0 };
  }
  const floorTexCache = {};
  function floorTex(type) {
    if (floorTexCache[type]) return floorTexCache[type];
    const f = floorCanvas(type, small ? 1024 : 2048), t = new THREE.CanvasTexture(f.c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.channel = 1;
    t.repeat.set(1 / f.m, 1 / f.m); t.rotation = f.rot;
    return (floorTexCache[type] = t);
  }

  /* ---------- materiały ---------- */
  const mats = {}, matGroup = {};
  for (const g of GROUPS) for (const m of g.mats) matGroup[m] = g;
  const baseOf = (n) => MM.m[ALIAS[n] || n] || { c: CLAY, r: 0.8 };
  function makeMat(name) {
    const b = baseOf(name);
    const m = new THREE.MeshStandardMaterial({ color: b.c, roughness: b.r ?? 0.8, metalness: b.m ? 1 : 0 });
    if (b.g) { m.transparent = true; m.opacity = 0.14; m.depthWrite = false; m.roughness = 0.04; m.color.set("#e8f0f0"); }
    else if (b.o) { m.transparent = true; m.opacity = 0.5; m.depthWrite = false; m.side = THREE.DoubleSide; }
    if (b.e) { m.emissive = new THREE.Color("#fff3df"); m.emissiveIntensity = 1.6; m.color.set("#ffffff"); }
    if (b.t) m.map = srcTex(b.t, ...(b.s || [1, 1]));
    m.lightMap = LM; m.lightMapIntensity = 0;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBakeK = U.uBakeK; sh.uniforms.uIbl = U.uIbl; sh.uniforms.uProbe = U.uProbe;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float lmw;varying float vLmw;varying vec3 vWP;varying vec3 vWN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLmw=lmw;vWP=position;vWN=normal;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
precision highp sampler3D;
varying float vLmw;varying vec3 vWP;varying vec3 vWN;uniform float uBakeK;uniform float uIbl;uniform sampler3D uProbe;
vec3 probeS(vec3 t,float slab){t=clamp(t,vec3(.5/44.,.5/30.,.5/11.),vec3(1.-.5/44.,1.-.5/30.,1.-.5/11.));vec4 c=texture(uProbe,vec3((t.x+slab)/6.,t.y,t.z));return c.rgb*c.rgb;}
vec3 probeIrr(vec3 p,vec3 n){vec3 nb=vec3(n.x,-n.z,n.y);vec3 t=(vec3(p.x,-p.z,p.y)+nb*.14-vec3(-5.5,-3.75,0.))/vec3(11.,7.5,2.75);vec3 w=nb*nb;
  return w.x*probeS(t,nb.x>0.?0.:1.)+w.y*probeS(t,nb.y>0.?2.:3.)+w.z*probeS(t,nb.z>0.?4.:5.);}`)
        .replace("#include <lights_fragment_end>", "if(uBakeK>0.){vec3 wn=normalize(vWN);if(!gl_FrontFacing)wn=-wn;irradiance+=(1.-vLmw)*probeIrr(vWP,wn)*uBakeK;}iblIrradiance*=uIbl;\n#include <lights_fragment_end>");
    };
    m.name = name;
    m.userData.base = b;
    return m;
  }
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  function tinted(m, hex) { // przemalowanie materiału z teksturą: dzielimy przez średni kolor skanu, żeby wybrany kolor był wierny
    m.color.set(hex);
    if (m.map && m.userData.base.t && MM.avg[m.userData.base.t] && m.map.channel !== 1) {
      tmpA.set(MM.avg[m.userData.base.t]);
      m.color.setRGB(Math.min(3, m.color.r / Math.max(0.04, tmpA.r)), Math.min(3, m.color.g / Math.max(0.04, tmpA.g)), Math.min(3, m.color.b / Math.max(0.04, tmpA.b)));
    }
  }
  function setMap(m, t) {
    if (m.map !== t) { m.map = t; m.needsUpdate = true; }
  }
  function applyAll() {
    for (const [name, m] of Object.entries(mats)) {
      const b = m.userData.base, g = matGroup[name];
      if (b.g || b.e) continue;
      setMap(m, b.t ? srcTex(b.t, ...(b.s || [1, 1])) : null);
      m.color.set(b.c);
      m.roughness = b.r ?? 0.8;
      if (FLOORMATS.includes(name) && (name === "M135" || state.floorAll)) {
        setMap(m, floorTex(state.floor));
        m.color.set(state.tint);
        m.roughness = { marble: 0.22, marble2: 0.22, tile: 0.42, concrete: 0.6 }[state.floor] ?? 0.5;
      } else if (g && state.colors[g.id]) tinted(m, state.colors[g.id]);
      if (state.custom[name]) {
        if (m.map && m.map.channel === 1) setMap(m, null);
        tinted(m, state.custom[name]);
      }
    }
    dirty = true;
    save();
    syncUI();
    queueEnv();
  }

  /* ---------- UI ---------- */
  function swatches(el, list, get, set, withOrig) {
    el.innerHTML = "";
    if (withOrig) {
      const b = document.createElement("button");
      b.className = "orig"; b.textContent = "Oryginał"; b.dataset.hex = ""; b.onclick = () => set(null);
      el.append(b);
    }
    for (const [name, hex] of list) {
      const b = document.createElement("button");
      b.style.setProperty("--c", hex); b.title = name; b.setAttribute("aria-label", name); b.dataset.hex = hex;
      b.onclick = () => set(hex);
      el.append(b);
    }
    const l = document.createElement("label");
    l.title = "Własny kolor";
    l.innerHTML = '+<input type="color" aria-label="Własny kolor">';
    const inp = l.querySelector("input");
    inp.id = el.id + "-custom";
    inp.oninput = () => set(inp.value);
    el.append(l);
    el._sync = () => {
      const cur = (get() || "").toLowerCase();
      for (const b of el.querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.hex === cur);
      if (/^#[0-9a-f]{6}$/.test(cur)) inp.value = cur;
      return cur ? (list.find((x) => x[1] === cur) || ["Własny kolor"])[0] : "oryginał";
    };
  }
  function setGroup(g, hex) {
    state.colors[g.id] = hex;
    state.style = null;
    for (const m of g.mats) delete state.custom[m];
    applyAll();
  }
  function paintPreview(cv, id) {
    const f = floorCanvas(id, 512), x = cv.getContext("2d");
    x.save();
    x.translate(80, 46);
    x.rotate(f.rot);
    const sc = id.startsWith("herring") ? 0.55 : 0.5;
    x.scale(sc, sc);
    x.fillStyle = x.createPattern(f.c, "repeat");
    x.fillRect(-400, -400, 800, 800);
    x.restore();
  }
  let picked = null;
  function buildUI() {
    for (const s of STYLES) {
      const b = document.createElement("button");
      b.className = "kr-style"; b.dataset.id = s.id;
      b.innerHTML = `<div class="kr-fan">${s.fan.map((c) => `<i style="background:${c}"></i>`).join("")}</div><b>${s.name}</b><small>${s.desc}</small>`;
      b.onclick = () => { applyStyleToState(s); hidePicked(); applyAll(); };
      $("#kr-styles").append(b);
    }
    for (const [id, name] of FLOORS) {
      const b = document.createElement("button");
      b.dataset.id = id;
      const cv = document.createElement("canvas");
      cv.width = 160; cv.height = 92;
      const sp = document.createElement("span");
      sp.textContent = name;
      b.append(cv, sp);
      b.onclick = () => {
        state.floor = id; state.floorAll = true; state.style = null;
        for (const m of FLOORMATS) delete state.custom[m];
        applyAll();
      };
      $("#kr-mats-floor").append(b);
    }
    swatches($("#kr-sw-floor"), PAINTS.floorTint, () => state.tint, (h) => {
      state.tint = h; state.style = null;
      for (const m of FLOORMATS) delete state.custom[m];
      applyAll();
    });
    for (const g of GROUPS) {
      const s = document.createElement("section");
      s.innerHTML = `<h2>${g.label} <span id="kr-n-${g.id}"></span></h2><div class="kr-sw" id="kr-sw-${g.id}"></div>`;
      $("#kr-groups").append(s);
      swatches(s.querySelector(".kr-sw"), PAINTS[g.pal], () => state.colors[g.id], (h) => setGroup(g, h), true);
    }
    swatches($("#kr-sw-picked"), PAINTS.textile.concat(PAINTS.joinery.slice(0, 5)), () => picked && state.custom[picked], (h) => {
      if (!picked) return;
      if (h) state.custom[picked] = h;
      else delete state.custom[picked];
      state.style = null;
      applyAll();
    }, true);

    // pasek widoków: powrót do makiety osiedla, potem grupy przycisków w stylu szklanych pigułek
    const vEl = $("#kr-views");
    const back = document.createElement("button");
    back.className = "kr-back";
    back.innerHTML = `${IKONA_WSTECZ}<span></span>`;
    back.querySelector("span").textContent = etykietaPowrotu;
    back.onclick = () => onZamknij();
    vEl.append(back);
    const seg = (label) => {
      const d = document.createElement("div");
      d.className = "kr-seg"; d.setAttribute("role", "group"); d.setAttribute("aria-label", label);
      vEl.append(d);
      return d;
    };
    const mk = (par, id, txt, fn) => {
      const b = document.createElement("button");
      b.textContent = txt; b.dataset.id = id; b.onclick = fn;
      par.append(b);
      return b;
    };
    const sWidok = seg("Widok");
    mk(sWidok, "model", "Makieta", () => setModel());
    mk(sWidok, "walk", "Spacer", () => enterWalk(ROOMS[0]));
    const sPokoje = seg("Pomieszczenia");
    for (const r of ROOMS) mk(sPokoje, r.id, r.name, () => enterWalk(r));
    const sSwiatlo = seg("Światło");
    mk(sSwiatlo, "eve", "Wieczór", () => { state.light = "eve"; setLight(); save(); syncUI(); });
    mk(sSwiatlo, "day", "Dzień", () => { state.light = "day"; setLight(); save(); syncUI(); });
    $("#kr-reset").onclick = () => { applyStyleToState(STYLES[0]); hidePicked(); applyAll(); };
  }
  function hidePicked() {
    picked = null;
    $("#kr-pickedBox").hidden = true;
  }
  function syncUI() {
    for (const b of root.querySelectorAll(".kr-style")) b.setAttribute("aria-pressed", b.dataset.id === state.style);
    for (const b of root.querySelectorAll("#kr-mats-floor button")) b.setAttribute("aria-pressed", b.dataset.id === state.floor);
    $("#kr-n-floor").textContent = (FLOORS.find((f) => f[0] === state.floor) || [, ""])[1] + " · " + $("#kr-sw-floor")._sync().toLowerCase();
    for (const g of GROUPS) $("#kr-n-" + g.id).textContent = $("#kr-sw-" + g.id)._sync();
    $("#kr-sw-picked")._sync();
    for (const b of root.querySelectorAll("#kr-views button[data-id]"))
      b.setAttribute("aria-pressed", b.dataset.id === mode || (mode === "walk" && b.dataset.id === curRoom) || b.dataset.id === (isEve() ? "eve" : "day"));
    $("#kr-hint").textContent = mode === "walk"
      ? "Przeciągnij, aby się rozejrzeć · W A S D lub strzałki: chodzenie · kliknij podłogę, aby tam przejść · kliknij element, aby zmienić kolor"
      : "Przeciągnij, aby obrócić · kółko lub szczypnięcie przybliża · kliknij element, aby zmienić jego kolor";
    $("#kr-joy").hidden = mode !== "walk";
  }

  /* ---------- widoki: makieta (orbita) i spacer (pierwsza osoba) ---------- */
  let curRoom = null;
  const shell = [], colliders = [];
  const walk = { yaw: 0, pitch: -0.08, keys: {}, jx: 0, jy: 0, goto: null };
  function setLight() {
    const onWalk = mode === "walk", eve = isEve(), k = eve ? Math.PI * BAKE_RANGE * BAKE_EXPO : 0;
    for (const m of shell) m.castShadow = onWalk;
    sun.visible = !eve; hemi.visible = !eve;
    if (!eve) sun.shadow.needsUpdate = true;
    for (const l of lamps) l.intensity = onWalk && !eve ? 5.5 : 0;
    hemi.intensity = onWalk ? 0.42 : 0.5;
    sun.intensity = onWalk ? 3.2 : 2.2;
    U.uBakeK.value = k; U.uIbl.value = eve ? 0 : 1;
    for (const m of Object.values(mats)) {
      m.lightMapIntensity = k;
      if (m.userData.base.e) m.emissiveIntensity = eve ? 4 : 1.6;
    }
    scene.environment = eve && envEve ? envEve : envDay;
    scene.environmentIntensity = eve ? (envEve ? 1 : 0.15) : onWalk ? 0.42 : 0.5;
    lampGlow.emissiveIntensity = eve ? 5 : 0.15;
    if (mats.M160) { mats.M160.emissive.set("#ffcf96"); mats.M160.emissiveIntensity = eve ? 0.55 : 0; }
    if (bloom) bloom.enabled = eve;
    themeBg();
    if (eve) queueEnv();
    dirty = true;
  }
  /* odbicia wieczorem: sonda renderowana w salonie */
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }), cubeCam = new THREE.CubeCamera(0.1, 40, cubeRT);
  cubeCam.position.set(-0.6, 1.35, -1.5);
  let envEve = null, envTimer = 0;
  const meshes = [];
  function refreshEnv() {
    if (!zyje || !isEve() || !meshes.length) return;
    const cp = renderer.clippingPlanes, sv = sky.visible;
    renderer.clippingPlanes = []; sky.visible = true;
    scene.environment = envEve || envDay;
    scene.environmentIntensity = envEve ? 1 : 0.15;
    cubeCam.update(renderer, scene);
    const t = pmrem.fromCubemap(cubeRT.texture).texture;
    if (envEve) envEve.dispose();
    envEve = t;
    scene.environment = t; scene.environmentIntensity = 1;
    sky.visible = sv; renderer.clippingPlanes = cp;
    dirty = true;
  }
  function queueEnv() {
    if (!isEve()) return;
    clearTimeout(envTimer);
    envTimer = setTimeout(refreshEnv, 300);
  }
  function setModel() {
    mode = "model"; curRoom = null; controls.enabled = true; walk.goto = null;
    camera.position.set(...MODEL.pos);
    controls.target.set(...MODEL.target);
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    setFov(); setLight(); themeBg(); syncUI();
    dirty = true;
  }
  function enterWalk(r) {
    mode = "walk"; curRoom = r.id; controls.enabled = false; walk.goto = null;
    camera.position.set(r.pos[0], EYE, r.pos[1]);
    walk.yaw = Math.atan2(-(r.look[0] - r.pos[0]), -(r.look[1] - r.pos[1]));
    walk.pitch = -0.1;
    camera.rotation.order = "YXZ";
    camera.rotation.set(walk.pitch, walk.yaw, 0);
    setFov(); setLight(); themeBg(); syncUI();
    dirty = true;
    canvas.focus({ preventScroll: true });
  }
  const ray = new THREE.Raycaster();
  const v2 = new THREE.Vector3(), dirv = new THREE.Vector3();
  function freeDist(x, z, dx, dz, len) { // ile można przejść do ściany albo szafy
    ray.set(v2.set(x, 0.9, z), dirv.set(dx, 0, dz).normalize());
    ray.far = len + 0.3;
    const h = ray.intersectObjects(colliders, false);
    return h.length ? Math.max(0, h[0].distance - 0.3) : len;
  }
  function tryMove(dx, dz) {
    const p = camera.position, len = Math.hypot(dx, dz);
    if (len < 1e-5) return false;
    let d = freeDist(p.x, p.z, dx, dz, len), moved = false;
    if (d > 0.002) { p.x += (dx / len) * d; p.z += (dz / len) * d; moved = true; }
    if (d < len - 1e-4) { // ślizg wzdłuż przeszkody
      for (const [ax, az] of [[dx, 0], [0, dz]]) {
        const l = Math.abs(ax + az);
        if (l < 1e-4) continue;
        const dd = freeDist(p.x, p.z, ax, az, l);
        if (dd > 0.002) { p.x += Math.sign(ax) * dd; p.z += Math.sign(az) * dd; moved = true; }
      }
    }
    p.x = Math.min(5.05, Math.max(-5.25, p.x));
    p.z = Math.min(3.4, Math.max(-3.05, p.z));
    return moved;
  }
  function walkStep(dt) {
    const k = walk.keys;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) - walk.jy, s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + walk.jx, turn = (k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0);
    let ch = false;
    if (turn) { walk.yaw += turn * 1.8 * dt; ch = true; }
    if (f || s) {
      walk.goto = null;
      const sp = (k.ShiftLeft || k.ShiftRight ? 3.6 : 2.0) * dt, sn = Math.sin(walk.yaw), cs = Math.cos(walk.yaw);
      const n = Math.max(1, Math.hypot(f, s));
      ch = tryMove(((-sn * f + cs * s) / n) * sp, ((-cs * f - sn * s) / n) * sp) || ch;
    } else if (walk.goto) {
      const p = camera.position, dx = walk.goto.x - p.x, dz = walk.goto.z - p.z, d = Math.hypot(dx, dz), sp = 2.6 * dt;
      if (d < 0.05 || !tryMove((dx / d) * Math.min(sp, d), (dz / d) * Math.min(sp, d))) walk.goto = null;
      ch = true;
    }
    if (ch) { camera.rotation.set(walk.pitch, walk.yaw, 0); dirty = true; moving = true; lastMove = performance.now(); }
  }
  on(window, "keydown", (e) => {
    if (mode !== "walk" || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (/^(Key[WASD]|Arrow|Shift)/.test(e.code)) {
      walk.keys[e.code] = true;
      if (e.code.startsWith("Arrow")) e.preventDefault();
    }
  });
  on(window, "keyup", (e) => { walk.keys[e.code] = false; });
  on(window, "blur", () => { walk.keys = {}; });
  /* joystick na ekranach dotykowych */
  {
    const j = $("#kr-joy"), kn = $("#kr-knob");
    let id = null;
    const set = (e) => {
      const r = j.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      walk.jx = x; walk.jy = y;
      kn.style.transform = `translate(${x * 30}px,${y * 30}px)`;
    };
    j.addEventListener("pointerdown", (e) => { id = e.pointerId; j.setPointerCapture(id); set(e); e.preventDefault(); });
    j.addEventListener("pointermove", (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; walk.jx = walk.jy = 0; kn.style.transform = "";
    };
    j.addEventListener("pointerup", end);
    j.addEventListener("pointercancel", end);
  }

  /* ---------- wskaźnik: rozglądanie, wybór elementu, przejście ---------- */
  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    ray.far = 100;
    for (const h of ray.intersectObjects(meshes, false)) {
      if (renderer.clippingPlanes.some((pl) => pl.distanceToPoint(h.point) < 0)) continue;
      const n = h.object.material.name, b = h.object.material.userData.base;
      if (b.g || b.o) continue;
      return { mat: n, point: h.point, up: h.face && h.face.normal.y > 0.7 };
    }
    return null;
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), lx: e.clientX, ly: e.clientY, id: e.pointerId };
    if (mode === "walk") canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down || mode !== "walk" || e.pointerId !== down.id) return;
    walk.yaw += (e.clientX - down.lx) * 0.0042;
    walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch + (e.clientY - down.ly) * 0.0042));
    down.lx = e.clientX; down.ly = e.clientY;
    camera.rotation.set(walk.pitch, walk.yaw, 0);
    dirty = true; moving = true; lastMove = performance.now();
  });
  canvas.addEventListener("pointercancel", () => { down = null; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (d > 6 || dt > 600) return;
    const h = pickAt(e.clientX, e.clientY);
    if (!h) return;
    if (mode === "walk" && h.up && h.point.y < 0.12) { walk.goto = { x: h.point.x, z: h.point.z }; return; }
    const m = mats[h.mat], g = matGroup[h.mat];
    const oc = m.color.clone();
    m.color.lerp(tmpB.set(BLYSK), 0.45);
    dirty = true;
    setTimeout(() => { if (!zyje) return; m.color.copy(oc); applyAll(); }, 230);
    const sec = FLOORMATS.includes(h.mat) ? $("#kr-mats-floor") : g && !state.custom[h.mat] ? $("#kr-sw-" + g.id) : null;
    if (sec) {
      hidePicked();
      sec.closest("section").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    picked = h.mat;
    $("#kr-pickedName").textContent = "Wybrany element (kolor zmienia się wraz z podobnymi)";
    $("#kr-pickedBox").hidden = false;
    $("#kr-pickedBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    syncUI();
  });

  /* ---------- wczytanie ---------- */
  function mergeGroup(list, floorish) { // jedno wywołanie rysowania na materiał zamiast na obiekt
    let nv = 0, ni = 0;
    for (const o of list) {
      nv += o.geometry.attributes.position.count;
      ni += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), lw = new Float32Array(nv), uv2 = new Float32Array(nv * 2), uv1 = floorish ? new Float32Array(nv * 2) : null, idx = new Uint32Array(ni);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const o of list) {
      const g = o.geometry, p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, lA = g.attributes.uv1, mw = o.matrixWorld, flip = mw.determinant() < 0;
      nm.getNormalMatrix(mw);
      for (let i = 0; i < p.count; i++) {
        const q = vo + i;
        v.fromBufferAttribute(p, i).applyMatrix4(mw);
        pos[q * 3] = v.x; pos[q * 3 + 1] = v.y; pos[q * 3 + 2] = v.z;
        const X = v.x, Y = v.y, Z = v.z;
        if (n) v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        else v.set(0, 1, 0);
        nor[q * 3] = v.x; nor[q * 3 + 1] = v.y; nor[q * 3 + 2] = v.z;
        if (u) { uv[q * 2] = u.getX(i); uv[q * 2 + 1] = u.getY(i); }
        if (lA) { uv2[q * 2] = lA.getX(i); uv2[q * 2 + 1] = lA.getY(i); lw[q] = 1; }
        else { uv2[q * 2] = BLANK[0]; uv2[q * 2 + 1] = BLANK[1]; }
        if (uv1) { // UV w metrach, żeby wzory podłóg miały prawdziwą skalę
          const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
          if (ay >= ax && ay >= az) { uv1[q * 2] = X; uv1[q * 2 + 1] = Z; }
          else if (ax > az) { uv1[q * 2] = Z; uv1[q * 2 + 1] = Y; }
          else { uv1[q * 2] = X; uv1[q * 2 + 1] = Y; }
        }
      }
      const c = g.index ? g.index.count : p.count;
      for (let i = 0; i < c; i += 3) {
        const a = g.index ? g.index.getX(i) : i, b = g.index ? g.index.getX(i + 1) : i + 1, d = g.index ? g.index.getX(i + 2) : i + 2;
        idx[io + i] = vo + a; idx[io + i + 1] = vo + (flip ? d : b); idx[io + i + 2] = vo + (flip ? b : d);
      }
      vo += p.count;
      io += c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("uv2", new THREE.BufferAttribute(uv2, 2));
    g.setAttribute("lmw", new THREE.BufferAttribute(lw, 1));
    if (uv1) g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return new THREE.Mesh(g, list[0].material);
  }
  buildUI();
  resize();
  setModel();
  const postep = (got, total) => {
    $("#kr-prog").style.width = Math.min(100, (got / total) * 100) + "%";
    $("#kr-loadmb").textContent = `${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
  };
  const loader = new GLTFLoader();
  Promise.all([
    (async () => {
      const r = await fetch(BAZA + "apartment.glb", { signal: ac.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      let buf;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader(), parts = [];
        let got = 0;
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          parts.push(value);
          got += value.length;
          postep(got, Math.max(got, ROZMIAR_GLB));
        }
        buf = new Uint8Array(got);
        let o = 0;
        for (const p of parts) { buf.set(p, o); o += p.length; }
      } else buf = new Uint8Array(await r.arrayBuffer());
      $("#kr-loadtitle").textContent = "Przygotowuję wnętrze…";
      return new Promise((res, rej) => loader.parse(buf.buffer, "", res, rej));
    })(),
    ...["oak", "ash", "walnut", "marble", "marble2", "tile", "tile2", "concrete"].map(loadImg),
  ]).then(([g]) => {
    if (!zyje) return;
    g.scene.updateMatrixWorld(true);
    const groups = {}, box = new THREE.Box3();
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const n = OBJMAT[o.name] || OBJMAT[o.parent && o.parent.name] || o.material.name;
      mats[n] = mats[n] || makeMat(n);
      o.material = mats[n];
      box.setFromObject(o);
      const isShell = n === "M139" || n === "M136" || n === "M175" || n === "M176" || box.min.y > 2.3;
      if (n === "M1" && o.parent) {
        const w = o.getWorldPosition(new THREE.Vector3());
        w.y += 0.022;
        o.position.copy(o.parent.worldToLocal(w));
        o.updateMatrixWorld(true);
      }
      const cen = box.getCenter(new THREE.Vector3()), cell = Math.floor((cen.x + 5.6) / 2.8) + "_" + Math.floor((cen.z + 3.8) / 2.5); // podział na obszary: pokoje poza kadrem są pomijane
      const key = n + "|" + (isShell ? 1 : 0) + "|" + cell;
      (groups[key] = groups[key] || { list: [], n, isShell, b: mats[n].userData.base }).list.push(o);
    });
    for (const G of Object.values(groups)) {
      const m = mergeGroup(G.list, FLOORMATS.includes(G.n)), thin = G.b.g || G.b.o || G.b.e;
      m.castShadow = !thin && !G.isShell;
      m.receiveShadow = !G.b.g;
      if (G.isShell && !thin) shell.push(m);
      if (["M139", "M175", "M176", "M140", "M147", "M146", "M150", "BATH", "M89"].includes(G.n)) colliders.push(m);
      scene.add(m);
      meshes.push(m);
    }
    // geometrie źródłowe są już scalone: zwalniamy je od razu
    g.scene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const b of root.querySelectorAll("#kr-mats-floor button")) paintPreview(b.querySelector("canvas"), b.dataset.id);
    setLight();
    applyAll();
    $("#kr-loader").classList.add("done");
    window.__kreator = { ready: true, state, walk, colliders, meshes, camera, pick: (x, y) => pickAt(x, y), renderer };
  }).catch((e) => {
    if (!zyje) return;
    $("#kr-loadtitle").textContent = "Nie udało się wczytać mieszkania";
    $("#kr-loadnote").textContent = "Odśwież stronę. Szczegóły: " + ((e && e.message) || e);
  });

  let lastT = performance.now(), ft = 16, raf = 0;
  function frame() {
    if (!zyje) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now(), rawDt = now - lastT, dt = Math.min(0.05, rawDt / 1000);
    lastT = now;
    if (mode === "walk") walkStep(dt);
    else if (controls.update()) dirty = true;
    if (moving && now - lastMove > 500) { // w spoczynku: pełna rozdzielczość
      moving = false;
      if (resScale < 1) applyRes(1);
    }
    if (dirty) {
      dirty = false;
      if (moving) {
        ft = ft * 0.85 + Math.min(rawDt, 100) * 0.15;
        if (resScale === 1 && motionScale < 1) applyRes(motionScale);
        else if (now - lastResChange > 350) { // cel: ok. 50–60 klatek na sekundę
          if (ft > 22 && motionScale > 0.6) { motionScale = Math.max(0.6, motionScale - 0.1); applyRes(motionScale); }
          else if (ft < 13 && motionScale < 1) { motionScale = Math.min(1, motionScale + 0.05); applyRes(motionScale); }
        }
      }
      updateClip();
      if (composer) composer.render();
      else renderer.render(scene, camera);
    }
  }
  controls.addEventListener("change", () => { dirty = true; moving = true; lastMove = performance.now(); });
  frame();

  /* ---------- zamknięcie: zwolnienie wszystkiego, co trzyma pamięć GPU ---------- */
  function zniszcz() {
    if (!zyje) return;
    zyje = false;
    cancelAnimationFrame(raf);
    clearTimeout(envTimer);
    ac.abort();
    for (const f of sprzatanie) f();
    ro.disconnect();
    controls.dispose();
    for (const m of meshes) m.geometry.dispose();
    for (const g of lampGeo) g.dispose();
    lampGlow.dispose(); lampDark.dispose();
    sky.geometry.dispose(); sky.material.dispose(); duskTex.dispose();
    for (const m of Object.values(mats)) m.dispose();
    for (const t of Object.values(texVar)) t.dispose();
    for (const t of Object.values(texBase)) t.dispose();
    for (const t of Object.values(floorTexCache)) t.dispose();
    LM.dispose();
    U.uProbe.value.dispose();
    probeTex.dispose();
    envDay.dispose();
    if (envEve) envEve.dispose();
    cubeRT.dispose();
    pmrem.dispose();
    if (sun.shadow.map) sun.shadow.map.dispose();
    if (gtao) gtao.dispose();
    if (bloom) bloom.dispose();
    if (composer) composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML = "";
    if (window.__kreator) delete window.__kreator;
  }
  return { zniszcz };
}
