/* ------------------------------------------------------------------
   MyLizaSwim : le lieu (scène three.js)
   Trois espaces reliés par la caméra :
     1. le salon d'accueil      z de +14 à +3.5   (bois, cuir, cheminée)
     2. la piscine intérieure   z de +3.5 à -20   (pierre, colonnes, LED)
     3. la terrasse             z de -20 à -46    (dalles, fauteuils tressés)
   Tout est procédural : aucun modèle 3D externe. Unités : mètres.
   Le bassin va de z = 0 (plots) à z = -16.
------------------------------------------------------------------- */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';

export const COLORS = {
  blue: '#2F39DA',
  orange: '#D4713D',
  ink: '#0D1240',
  navy: '#1C2266',
  majorelle: '#2F39DA',
  majorelleGlow: '#5562FF',
  amber: '#FFAE62',
  teak: '#8F6142',
  cream: '#EEE6D8',
  white: '#F5F2EC',
};

export const POOL = { w: 7.5, l: 16, floor: -1.6, water: -0.14 };
export const LANES = [-2.5, 0, 2.5];
const ROPES = [-1.25, 1.25];
const HALL = { x: 9, near: 3.5, far: -20, h: 7.2, mezz: 3.4, col: 6.3 };
const LOUNGE = { x: 7, back: 14, h: 3.4 };

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const FONT = '"Jost Variable", "Jost", system-ui, sans-serif';

/* ---------- helpers ---------- */
function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.userData.redraw = () => { g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; };
  return t;
}
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
const phys = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, ...extra });
function rbox(w, h, d, r = 0.02, seg = 2) {
  const rr = Math.min(r, Math.min(w, h, d) / 2 - 1e-4);
  return rr > 0.001 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
}
function meshAt(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function shadow(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
const rnd = (a, b) => a + Math.random() * (b - a);

/* ==================================================================
   createWorld
================================================================== */
export function createWorld(renderer, { quality = 'high' } = {}) {
  const scene = new THREE.Scene();
  // par défaut, tout objet créé ici est ajouté à la scène
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = scene) => meshAt(geo, mat, x, y, z, parent);
  const low = quality === 'low';
  const textures = []; // à redessiner une fois polices et logo chargés
  const floaters = []; // objets qui suivent le niveau de l'eau
  const clickables = []; // { root, station, sub }
  const anchors = {}; // ancres des pastilles HTML
  const state = { level: POOL.water, fill: 1, time: 0, underwater: false };
  let logoImg = null;

  /* ---------- environnement, ciel ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;

  const SUN_DIR = v3(0.35, 0.8, 0.45).normalize();
  // ciel de fin de journée : bleu marque au zénith, orange à l'horizon (vu depuis la terrasse)
  const sky = mesh(new THREE.SphereGeometry(170, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#141C78') },
      uHigh: { value: new THREE.Color('#3A40B8') },
      uHorizon: { value: new THREE.Color('#F08A4C') },
      uGround: { value: new THREE.Color('#5A3A2A') },
      uSun: { value: v3(-0.25, 0.12, -0.96).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vP;
      void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith; uniform vec3 uHigh; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSun; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = h > 0.0
          ? mix(mix(uHorizon, uHigh, smoothstep(0.0, 0.22, h)), uZenith, smoothstep(0.2, 0.75, h))
          : mix(uHorizon, uGround, smoothstep(0.0, 0.2, -h));
        float s = max(dot(normalize(vP), uSun), 0.0);
        c += vec3(1.0, 0.75, 0.5) * (pow(s, 40.0) * 0.8 + pow(s, 5.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  /* ---------- lumière ---------- */
  // très peu de lumière d'ambiance : l'espace vit par ses sources (lampes, LED, eau, soleil couchant)
  scene.add(new THREE.HemisphereLight('#7A5C46', '#1A120C', 0.42));
  // soleil couchant rasant depuis la terrasse : le mur du fond et le plafond font écran,
  // il n'entre dans le hall que par la porte vitrée (une flaque de lumière orange au sol)
  const key = new THREE.DirectionalLight('#FFA45E', 2.6);
  key.target.position.set(0, 0, -8);
  key.position.copy(key.target.position).addScaledVector(v3(-0.25, 0.36, -0.9).normalize(), 50);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 1, far: 110 });
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  // spots du plafond : des flaques de lumière chaude sur chaque élément
  const beamTex = canvasTexture(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.75)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const spot = (x, y, z, tx, ty, tz, { color = '#FFC48A', intensity = 48, angle = 0.42, beam = true, castShadow = false, parent = scene } = {}) => {
    const sp = new THREE.SpotLight(color, intensity, 16, angle, 0.85, 1.6);
    sp.position.set(x, y, z);
    sp.target.position.set(tx, ty, tz);
    if (castShadow) { sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0008; sp.shadow.radius = 6; }
    parent.add(sp, sp.target);
    if (beam) {
      // faisceau visible dans l'air (cône additif très léger)
      const len = Math.hypot(x - tx, y - ty, z - tz);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(angle) * len * 0.9, len, 32, 1, true),
        new THREE.MeshBasicMaterial({ map: beamTex, color, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.geometry.translate(0, -len / 2, 0);
      cone.position.set(x, y, z);
      cone.lookAt(tx, ty, tz); cone.rotateX(-Math.PI / 2);
      cone.renderOrder = 9;
      parent.add(cone);
    }
    return sp;
  };

  /* ---------- textures partagées ---------- */
  const glowTex = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const leafTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4F6E49'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2800; i++) {
      g.fillStyle = Math.random() > 0.5 ? `rgba(130,160,115,${rnd(0.2, 0.5)})` : `rgba(25,45,28,${rnd(0.25, 0.55)})`;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(1, 4.5), 0, Math.PI * 2); g.fill();
    }
  }, { repeat: [3, 2] });
  const leafM = std('#ffffff', { map: leafTex, roughness: 0.95 });
  const ledM = new THREE.MeshBasicMaterial({ color: '#FFB066' });
  const ledBlueM = new THREE.MeshBasicMaterial({ color: '#5866FF' });
  const downM = new THREE.MeshBasicMaterial({ color: '#FFE7C8' });
  const bronze = std('#3B2C20', { roughness: 0.35, metalness: 0.6 });
  // flaque de lumière au sol (décalque additif)
  const lightPool = (x, z, rx, rz, color, opacity, y = 0.012, parent = scene) => {
    const m = meshAt(new THREE.PlaneGeometry(rx * 2, rz * 2), new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }), x, y, z, parent);
    m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
    return m;
  };
  // lavage de mur : un cône de lumière qui glisse sur la pierre
  const washTex = canvasTexture(128, 256, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const k = y / h, half = 6 + k * w * 0.5, a = Math.pow(1 - k, 1.4) * 0.95;
      const grd = g.createLinearGradient(w / 2 - half, 0, w / 2 + half, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, `rgba(255,255,255,${a})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, y, w, 1);
    }
  });
  const wallWash = (x, y, z, rotY, w, h, color, opacity, up = false) => {
    const m = meshAt(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: washTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }), x, y, z, scene);
    m.rotation.y = rotY; if (up) m.rotation.z = Math.PI;
    m.renderOrder = 3;
    return m;
  };
  const steel = std('#D3D8DF', { metalness: 1, roughness: 0.18 });
  const concrete = std('#6B5A4A', { roughness: 0.85 });

  const stoneDraw = (base, vein) => (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${rnd(90, 140)},${rnd(70, 110)},${rnd(50, 80)},${rnd(0.02, 0.07)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 5), rnd(1, 3));
    }
    g.strokeStyle = vein; g.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = rnd(0.12, 0.3);
      g.beginPath();
      const y = Math.random() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + rnd(-60, 60), w * 0.6, y + rnd(-60, 60), w, y + rnd(-40, 40));
      g.stroke();
    }
    g.globalAlpha = 1;
  };

  /* ==================================================================
     LA PISCINE INTÉRIEURE
  ================================================================== */
  // sol en pierre chaude, grandes dalles
  const deckTex = canvasTexture(512, 512, (g, w, h) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const v = rnd(-8, 8);
      g.fillStyle = `rgb(${88 + v},${68 + v},${52 + v})`;
      g.fillRect(i * w / 2, j * h / 2, w / 2, h / 2);
    }
    stoneDraw('rgba(0,0,0,0)', 'rgba(255,220,180,0.25)')(g, w, h);
    g.fillStyle = 'rgba(30,22,16,0.8)';
    for (let k = 0; k <= 2; k++) { g.fillRect(k * w / 2 - 1, 0, 2, h); g.fillRect(0, k * h / 2 - 1, w, 2); }
  }, { repeat: [1 / 1.8, 1 / 1.8] });
  const deckShape = new THREE.Shape();
  deckShape.moveTo(-HALL.x, -HALL.near); deckShape.lineTo(HALL.x, -HALL.near);
  deckShape.lineTo(HALL.x, -HALL.far); deckShape.lineTo(-HALL.x, -HALL.far); deckShape.lineTo(-HALL.x, -HALL.near);
  const hole = new THREE.Path();
  hole.moveTo(-3.75, 0); hole.lineTo(-3.75, 16); hole.lineTo(3.75, 16); hole.lineTo(3.75, 0); hole.lineTo(-3.75, 0);
  deckShape.holes.push(hole);
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: 1.9, bevelEnabled: false, curveSegments: 4 });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, -1.9, 0);
  const deck = new THREE.Mesh(deckGeo, [std('#ffffff', { map: deckTex, roughness: 0.42 }), std('#3A2C21')]);
  deck.receiveShadow = true;
  scene.add(deck);

  const copShape = new THREE.Shape();
  copShape.moveTo(-4.12, -0.38); copShape.lineTo(4.12, -0.38); copShape.lineTo(4.12, 16.38); copShape.lineTo(-4.12, 16.38); copShape.lineTo(-4.12, -0.38);
  const copHole = new THREE.Path();
  copHole.moveTo(-3.73, 0.02); copHole.lineTo(-3.73, 15.98); copHole.lineTo(3.73, 15.98); copHole.lineTo(3.73, 0.02); copHole.lineTo(-3.73, 0.02);
  copShape.holes.push(copHole);
  const copGeo = new THREE.ExtrudeGeometry(copShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 4 });
  copGeo.rotateX(-Math.PI / 2);
  const coping = new THREE.Mesh(copGeo, std('#8C7764', { roughness: 0.45 }));
  coping.receiveShadow = true;
  scene.add(coping);

  // bassin : mosaïque turquoise, lignes de fond sombres
  const PX = 128;
  const mosaic = (g, w, h, step) => {
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const v = rnd(-10, 10);
      g.fillStyle = `rgb(${40 + v},${60 + v},${178 + v})`;
      g.fillRect(x, y, step - 1, step - 1);
    }
  };
  const floorTex = canvasTexture(POOL.w * PX, POOL.l * PX, (g, w, h) => {
    g.fillStyle = '#1E2A8C'; g.fillRect(0, 0, w, h);
    mosaic(g, w, h, PX / 8);
    g.fillStyle = '#0B1040';
    LANES.forEach((lx) => {
      const cx = (lx + POOL.w / 2) * PX;
      g.fillRect(cx - PX * 0.13, 2 * PX, PX * 0.26, (POOL.l - 4) * PX);
      g.fillRect(cx - PX * 0.5, 2 * PX, PX, PX * 0.26);
      g.fillRect(cx - PX * 0.5, (POOL.l - 2) * PX - PX * 0.26, PX, PX * 0.26);
    });
    if (logoImg) {
      g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI); g.globalAlpha = 0.85;
      const s = PX * 1.7;
      g.fillStyle = '#E9F4F2'; g.beginPath(); g.arc(0, 0, s * 0.47, 0, Math.PI * 2); g.fill();
      g.drawImage(logoImg, -s / 2, -s / 2, s, s);
      g.restore();
    }
  });
  textures.push(floorTex);
  const endWallTex = canvasTexture(POOL.w * PX, 1.6 * PX, (g, w, h) => {
    g.fillStyle = '#1E2A8C'; g.fillRect(0, 0, w, h);
    mosaic(g, w, h, PX / 8);
    g.fillStyle = '#0B1040';
    LANES.forEach((lx) => {
      const cx = (lx + POOL.w / 2) * PX;
      g.fillRect(cx - PX * 0.13, PX * 0.3, PX * 0.26, h - PX * 0.3);
      g.fillRect(cx - PX * 0.5, PX * 0.48, PX, PX * 0.26);
    });
  });
  const sideWallTex = canvasTexture(256, 256, (g, w, h) => { g.fillStyle = '#1E2A8C'; g.fillRect(0, 0, w, h); mosaic(g, w, h, 16); }, { repeat: [POOL.l, 1.6] });
  const poolGlow = { emissive: '#4553F0', emissiveIntensity: 0.45 };
  const pool = new THREE.Group();
  const floor = mesh(new THREE.PlaneGeometry(POOL.w, POOL.l), std('#ffffff', { map: floorTex, roughness: 0.4, emissiveMap: floorTex, ...poolGlow }), 0, POOL.floor, -POOL.l / 2, pool);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const wallH = -POOL.floor;
  const mkWall = (w, tex, pos, rotY) => {
    const m = mesh(new THREE.PlaneGeometry(w, wallH), std('#ffffff', { map: tex, roughness: 0.35, emissiveMap: tex, ...poolGlow }), pos.x, pos.y, pos.z, pool);
    m.rotation.y = rotY; m.receiveShadow = true;
  };
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -0.004), Math.PI);
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -POOL.l + 0.004), 0);
  mkWall(POOL.l, sideWallTex, v3(-POOL.w / 2 + 0.004, POOL.floor / 2, -POOL.l / 2), Math.PI / 2);
  mkWall(POOL.l, sideWallTex, v3(POOL.w / 2 - 0.004, POOL.floor / 2, -POOL.l / 2), -Math.PI / 2);
  // projecteurs immergés et liseré lumineux sous la margelle
  {
    const lampM = new THREE.MeshBasicMaterial({ color: '#DDE2FF' });
    const lampGeo = new THREE.CircleGeometry(0.1, 24);
    for (let z = -2; z >= -14; z -= 4) {
      [-1, 1].forEach((side) => {
        const l = mesh(lampGeo, lampM, side * (POOL.w / 2 - 0.01), -0.62, z, pool);
        l.rotation.y = -side * Math.PI / 2;
      });
    }
    const stripM = new THREE.MeshBasicMaterial({ color: '#8E98FF', transparent: true, opacity: 0.8 });
    [[POOL.w, 0, -0.012], [POOL.w, 0, -POOL.l + 0.012]].forEach(([w, x, z]) => mesh(new THREE.BoxGeometry(w, 0.016, 0.01), stripM, x, -0.07, z, pool));
    [-1, 1].forEach((side) => mesh(new THREE.BoxGeometry(0.01, 0.016, POOL.l), stripM, side * (POOL.w / 2 - 0.012), -0.07, -POOL.l / 2, pool));
  }
  scene.add(pool);

  /* ---------- caustiques (voronoï animé, shader maison) ---------- */
  const NOISE = /* glsl */`
    vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
    float hash1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash1(i), hash1(i+vec2(1,0)), u.x), mix(hash1(i+vec2(0,1)), hash1(i+vec2(1,1)), u.x), u.y);
    }
    float cells(vec2 x, float t){
      vec2 n = floor(x), f = fract(x);
      float d1 = 8.0, d2 = 8.0;
      for (int j=-1; j<=1; j++) for (int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n+g);
        o = 0.5 + 0.45*sin(t + 6.2831*o);
        vec2 r = g + o - f;
        float d = dot(r,r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
      return sqrt(d2) - sqrt(d1);
    }`;
  const causticMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.45 } },
    vertexShader: /* glsl */`
      varying vec2 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uStrength; varying vec2 vW;
      ${NOISE}
      void main(){
        vec2 p = vW * 1.25;
        p += 0.35 * vec2(vnoise(p*0.7 + uTime*0.15), vnoise(p*0.7 - uTime*0.12));
        float a = cells(p, uTime*0.9);
        float b = cells(p*1.6 + 3.1, uTime*1.15);
        float c = pow(1.0 - smoothstep(0.0, 0.16, a), 2.2) * 0.75 + pow(1.0 - smoothstep(0.0, 0.12, b), 2.0) * 0.45;
        gl_FragColor = vec4(vec3(0.78, 0.84, 1.0) * c * uStrength, 1.0);
      }`,
  });
  const caustics = mesh(new THREE.PlaneGeometry(POOL.w, POOL.l), causticMat, 0, POOL.floor + 0.006, -POOL.l / 2);
  caustics.rotation.x = -Math.PI / 2;
  caustics.renderOrder = 1;
  scene.add(caustics);

  /* ---------- l'eau (vue de dessus ET de dessous) ---------- */
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#3E5CF0') },
      uDeep: { value: new THREE.Color('#121A78') },
      uCeil: { value: new THREE.Color('#120D0A') },
      uWall: { value: new THREE.Color('#6A4A33') },
      uLed: { value: new THREE.Color('#FFB066') },
      uFill: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uCeil; uniform vec3 uWall; uniform vec3 uLed; uniform float uFill;
      varying vec3 vW; varying vec2 vUv;
      ${NOISE}
      float height(vec2 p){
        float h = 0.0;
        h += sin(p.x*1.6 + uTime*0.9) * 0.3 + sin(p.y*1.25 - uTime*0.7) * 0.3;
        h += vnoise(p*2.1 + vec2(uTime*0.3, uTime*0.2)) * 1.0;
        h += vnoise(p*5.3 - vec2(uTime*0.5, -uTime*0.35)) * 0.4;
        return h;
      }
      void main(){
        vec2 p = vW.xz;
        float e = 0.04;
        float h = height(p);
        vec3 n = normalize(vec3(-(height(p + vec2(e,0.0))-h)/e*0.06, 1.0, -(height(p + vec2(0.0,e))-h)/e*0.06));
        vec3 V = normalize(cameraPosition - vW);
        if (!gl_FrontFacing) {
          // dessous de la surface : fenêtre de Snell lumineuse, miroir sombre en incidence rasante
          float cosv = clamp(-dot(vec3(n.x, -n.y, n.z), -V), 0.0, 1.0);
          float window = smoothstep(0.55, 0.85, abs(V.y));
          vec3 under = mix(vec3(0.05, 0.07, 0.3), vec3(0.5, 0.58, 1.0), window);
          under += vec3(0.85, 0.9, 1.0) * smoothstep(0.7, 1.0, vnoise(p*5.0 + uTime*0.8)) * 0.35 * window;
          gl_FragColor = vec4(under * (0.85 + 0.15 * cosv), 0.97 * uFill);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec2 edge = min(vUv, 1.0 - vUv);
        float centre = smoothstep(0.0, 0.18, min(edge.x*2.0, edge.y*4.0));
        vec3 col = mix(uShallow, uDeep, 0.25 + 0.35*centre);
        vec3 R = reflect(-V, n);
        vec3 refl = mix(uWall, uCeil, smoothstep(0.15, 0.6, R.y));
        // reflets des rubans LED du plafond
        float led = smoothstep(0.985, 1.0, sin(R.x / max(R.y, 0.2) * 7.0 + 1.3) * 0.5 + 0.5) * smoothstep(0.3, 0.7, R.y);
        col = mix(col, refl, clamp(fres*0.85, 0.0, 0.85));
        col += uLed * led * 0.8;
        float glint = smoothstep(0.9, 1.0, vnoise(p*10.0 + uTime*1.3)) * 0.35;
        col += vec3(1.0, 0.92, 0.8) * glint * (0.3 + fres);
        float rim = 1.0 - smoothstep(0.0, 0.012, min(edge.x*0.5, edge.y*0.25));
        col = mix(col, vec3(0.86,0.97,1.0), rim*0.4);
        float alpha = mix(0.52, 0.92, fres) + glint*0.3 + rim*0.3;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFill);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = mesh(new THREE.PlaneGeometry(POOL.w - 0.01, POOL.l - 0.01), waterMat, 0, POOL.water, -POOL.l / 2);
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 5;
  scene.add(water);

  /* ---------- lignes d'eau : noires, extrémités blanches ---------- */
  const floatGeo = new THREE.LatheGeometry([
    [0.0, -0.045], [0.03, -0.045], [0.05, -0.025], [0.056, 0], [0.05, 0.025], [0.03, 0.045], [0.0, 0.045],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  floatGeo.rotateX(Math.PI / 2);
  const SPACING = 0.112;
  const nFloats = Math.floor((POOL.l - 0.3) / SPACING);
  const ropes = ROPES.map((rx, ri) => {
    const m = new THREE.InstancedMesh(floatGeo, std('#ffffff', { roughness: 0.3 }), nFloats);
    const col = new THREE.Color();
    for (let i = 0; i < nFloats; i++) {
      const z = -0.15 - i * SPACING;
      col.set(Math.min(-z, POOL.l + z) < 1.6 ? COLORS.orange : '#141210');
      m.setColorAt(i, col);
    }
    m.userData = { x: rx, ri };
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  const dummy = new THREE.Object3D();
  function updateRopes(t) {
    ropes.forEach((m) => {
      const { x, ri } = m.userData;
      for (let i = 0; i < nFloats; i++) {
        const z = -0.15 - i * SPACING;
        dummy.position.set(x + Math.sin(t * 0.9 + z * 0.6 + ri) * 0.01, state.level + 0.01 + Math.sin(t * 1.5 + z * 0.9 + ri * 2) * 0.01, z);
        dummy.rotation.set(0, 0, Math.sin(t * 1.3 + z * 1.7) * 0.3);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    });
  }

  /* ---------- architecture du hall ---------- */
  const hallLen = HALL.near - HALL.far;
  const hallMid = (HALL.near + HALL.far) / 2;
  // alcôves : pierre rétroéclairée (le haut du mur reçoit la lumière de la corniche)
  const stoneTex = canvasTexture(1024, 256, (g, w, h) => {
    stoneDraw('#8A6A4E', 'rgba(255,215,170,0.35)')(g, w, h);
    g.fillStyle = 'rgba(30,20,12,0.45)';
    for (let k = 0; k <= 4; k++) g.fillRect(k * w / 4 - 1, 0, 2, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,190,120,0.55)');
    grd.addColorStop(0.4, 'rgba(255,190,120,0.06)');
    grd.addColorStop(1, 'rgba(10,6,3,0.45)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { repeat: [6, 1] });
  const alcoveM = std('#ffffff', { map: stoneTex, emissiveMap: stoneTex, emissive: '#FFB06A', emissiveIntensity: 0.22, roughness: 0.75 });
  const bandM = std('#5E4A3B', { roughness: 0.6 });
  const darkWall = std('#1C1510', { roughness: 0.9 });
  const columnM = std('#24180F', { roughness: 0.38, metalness: 0.2 });
  [-1, 1].forEach((side) => {
    const sx = side * HALL.x;
    const a = mesh(new THREE.PlaneGeometry(hallLen, HALL.mezz), alcoveM, sx, HALL.mezz / 2, hallMid);
    a.rotation.y = -side * Math.PI / 2;
    a.receiveShadow = true;
    const up = mesh(new THREE.PlaneGeometry(hallLen, HALL.h - HALL.mezz), darkWall, sx, (HALL.h + HALL.mezz) / 2, hallMid);
    up.rotation.y = -side * Math.PI / 2;
    // dalle de mezzanine, bandeau en pierre claire
    const slab = mesh(new THREE.BoxGeometry(3.0, 0.42, hallLen), bandM, side * (HALL.x - 1.5), HALL.mezz + 0.21, hallMid);
    slab.receiveShadow = true;
    // spots dans la sous-face
    for (let z = 2; z > HALL.far; z -= 2) {
      const d = mesh(new THREE.CircleGeometry(0.06, 16), downM, side * 7.6, HALL.mezz - 0.005, z);
      d.rotation.x = Math.PI / 2;
    }
    // garde-corps en verre + main courante bronze
    mesh(new THREE.PlaneGeometry(hallLen, 1.0), new THREE.MeshStandardMaterial({ color: '#BFD6D8', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }), side * (HALL.x - 3.02), HALL.mezz + 0.92, hallMid).rotation.y = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.05, 0.05, hallLen), bronze, side * (HALL.x - 3.02), HALL.mezz + 1.44, hallMid);
    // colonnes sombres sur toute la hauteur
    for (let z = 1.5; z > HALL.far; z -= 4) {
      const c = mesh(rbox(0.55, HALL.h, 0.55, 0.02), columnM, side * HALL.col, HALL.h / 2, z);
      c.castShadow = true; c.receiveShadow = true;
      // fente lumineuse verticale côté bassin
      mesh(new THREE.BoxGeometry(0.02, 2.2, 0.06), ledM, side * (HALL.col - 0.28), 1.5, z);
    }
  });
  // passerelle au fond (comme une mezzanine qui relie les deux côtés)
  mesh(new THREE.BoxGeometry(HALL.x * 2, 0.42, 1.4), bandM, 0, HALL.mezz + 0.21, HALL.far + 0.7);
  mesh(new THREE.PlaneGeometry(HALL.x * 2 - 6, 1.0), new THREE.MeshStandardMaterial({ color: '#BFD6D8', transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), 0, HALL.mezz + 0.92, HALL.far + 1.4);
  mesh(new THREE.BoxGeometry(HALL.x * 2 - 6, 0.05, 0.05), bronze, 0, HALL.mezz + 1.44, HALL.far + 1.4);
  // plafond sombre, double cadre de LED chaudes
  const ceil = mesh(new THREE.PlaneGeometry(HALL.x * 2, hallLen), std('#120D0A', { roughness: 0.9 }), 0, HALL.h, hallMid);
  ceil.rotation.x = Math.PI / 2;
  ceil.castShadow = true; // le plafond fait écran au soleil : la lumière n'entre que par la porte
  // cadre extérieur ambre, cadre intérieur bleu Majorelle
  [[5.4, 0.3, ledM], [3.2, 2.3, ledBlueM]].forEach(([hx, inset, m]) => {
    const z0 = HALL.near - 0.8 - inset, z1 = HALL.far + 0.8 + inset, len = z0 - z1, mid = (z0 + z1) / 2;
    [-1, 1].forEach((s) => mesh(new THREE.BoxGeometry(0.06, 0.03, len), m, s * hx, HALL.h - 0.03, mid));
    [z0, z1].forEach((z) => mesh(new THREE.BoxGeometry(hx * 2, 0.03, 0.06), m, 0, HALL.h - 0.03, z));
  });
  // rythme des travées : lavage ambre sur la pierre des alcôves, lavage bleu au-dessus des mezzanines
  [-1, 1].forEach((side) => {
    for (let z = -0.5; z > HALL.far + 1; z -= 4) {
      [-0.9, 0.9].forEach((dz) => wallWash(side * (HALL.x - 0.02), HALL.mezz - 1.5, z + dz, -side * Math.PI / 2, 1.5, 3.0, '#FFA65A', 0.5));
      wallWash(side * (HALL.x - 0.02), HALL.mezz + 2.2, z, -side * Math.PI / 2, 2.2, 3.3, '#4B57FF', 0.42, true);
      lightPool(side * 7.6, z, 1.1, 1.4, '#FFB070', 0.22);
    }
  });
  // rubans obliques au-dessus des mezzanines
  [-1, 1].forEach((side) => {
    for (let z = 0; z > HALL.far + 2; z -= 3.4) {
      const l = mesh(new THREE.BoxGeometry(2.4, 0.03, 0.05), ledM, side * 7.4, HALL.h - 0.03, z);
      l.rotation.y = side * 0.5;
    }
  });

  // mur côté salon : verrière avec large ouverture centrale
  {
    const glassM = new THREE.MeshPhysicalMaterial({ color: '#D9E6E4', transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.2 });
    const zf = HALL.near;
    [[-HALL.x, -2.4], [2.4, HALL.x]].forEach(([x0, x1]) => {
      const w = x1 - x0;
      mesh(new THREE.PlaneGeometry(w, HALL.mezz), glassM, (x0 + x1) / 2, HALL.mezz / 2, zf);
      for (let x = x0; x <= x1 + 0.01; x += w / Math.round(w / 1.6)) mesh(new THREE.BoxGeometry(0.05, HALL.mezz, 0.08), bronze, x, HALL.mezz / 2, zf);
    });
    mesh(new THREE.BoxGeometry(4.8, 0.12, 0.12), bronze, 0, HALL.mezz - 0.06, zf);
    const upper = mesh(new THREE.PlaneGeometry(HALL.x * 2, HALL.h - HALL.mezz), darkWall, 0, (HALL.h + HALL.mezz) / 2, zf);
    upper.rotation.y = Math.PI;
  }

  // mur du fond : porte vitrée vers la terrasse
  {
    const zb = HALL.far;
    const doorW = 4, doorH = 2.8;
    const farM = std('#ffffff', { map: stoneTex, emissiveMap: stoneTex, emissive: '#FFB06A', emissiveIntensity: 0.16, roughness: 0.8 });
    const sideW = HALL.x - doorW / 2;
    [-1, 1].forEach((s) => {
      const lo = mesh(new THREE.PlaneGeometry(sideW, HALL.mezz), farM, s * (doorW / 2 + sideW / 2), HALL.mezz / 2, zb);
      lo.receiveShadow = true; lo.castShadow = true;
      mesh(new THREE.PlaneGeometry(sideW, HALL.h - HALL.mezz), darkWall, s * (doorW / 2 + sideW / 2), (HALL.h + HALL.mezz) / 2, zb).castShadow = true;
      mesh(new THREE.BoxGeometry(0.14, doorH, 0.3), bronze, s * (doorW / 2 + 0.07), doorH / 2, zb);
    });
    mesh(new THREE.PlaneGeometry(doorW, HALL.h - doorH), darkWall, 0, (HALL.h + doorH) / 2, zb).castShadow = true;
    // halo du couchant dans l'embrasure
    const haze = mesh(new THREE.PlaneGeometry(doorW + 1.2, doorH + 0.8), new THREE.MeshBasicMaterial({ map: glowTex, color: '#FF9A50', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 0, doorH / 2, zb + 0.15);
    haze.renderOrder = 9;
    mesh(new THREE.BoxGeometry(doorW + 0.28, 0.14, 0.3), bronze, 0, doorH + 0.07, zb);
    // façade côté terrasse
    const facade = std('#7B6350', { roughness: 0.85 });
    [-1, 1].forEach((s) => { const f = mesh(new THREE.PlaneGeometry(sideW + 6, HALL.h), facade, s * (doorW / 2 + (sideW + 6) / 2), HALL.h / 2, zb - 0.03); f.rotation.y = Math.PI; f.castShadow = true; f.receiveShadow = true; });
    const ft = mesh(new THREE.PlaneGeometry(doorW, HALL.h - doorH), facade, 0, (HALL.h + doorH) / 2, zb - 0.03); ft.rotation.y = Math.PI; ft.castShadow = true;
    // appliques de façade
    [-1, 1].forEach((s) => {
      mesh(rbox(0.16, 0.5, 0.12, 0.03), bronze, s * (doorW / 2 + 0.6), 2.3, zb - 0.1);
      const sc = mesh(new THREE.PlaneGeometry(1.2, 2.4), new THREE.MeshBasicMaterial({ map: washTex, color: '#FFB066', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), s * (doorW / 2 + 0.6), 1.2, zb - 0.06);
      sc.rotation.y = Math.PI;
    });
    // vantaux vitrés ouverts
    [-1, 1].forEach((s) => {
      const leaf = new THREE.Group();
      mesh(new THREE.PlaneGeometry(1.0, doorH - 0.05), new THREE.MeshStandardMaterial({ color: '#CFE0DE', transparent: true, opacity: 0.18, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), s * -0.5, (doorH - 0.05) / 2, 0, leaf);
      mesh(new THREE.BoxGeometry(0.04, doorH - 0.05, 0.05), bronze, s * -1.0, (doorH - 0.05) / 2, 0, leaf);
      leaf.position.set(s * (doorW / 2 + 0.02), 0, zb - 0.05);
      leaf.rotation.y = s * 1.25;
      scene.add(leaf);
    });
  }

  /* ---------- 3 · plots de départ ---------- */
  const laneNames = [['1', 'AQUABABY'], ['2', 'ENFANTS'], ['3', 'JEUNES · ADULTES']];
  [...LANES].reverse().forEach((lx, i) => {
    const b = new THREE.Group();
    mesh(rbox(0.5, 0.62, 0.5, 0.04, 4), std('#3A2C22', { roughness: 0.35, metalness: 0.1 }), 0, 0.31, 0, b);
    const top = mesh(rbox(0.56, 0.05, 0.66, 0.02, 3), std(COLORS.teak, { roughness: 0.55 }), 0, 0.665, -0.04, b);
    top.rotation.x = 0.12;
    const tex = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#1A130E'; g.fillRect(0, 0, w, w);
      g.fillStyle = '#FFB27A'; g.font = `300 132px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(laneNames[i][0], w / 2, 104);
      g.fillStyle = COLORS.orange; g.fillRect(w / 2 - 18, 178, 36, 3);
      g.fillStyle = '#E9DCCB'; g.font = `600 ${laneNames[i][1].length > 10 ? 17 : 21}px ${FONT}`;
      if ('letterSpacing' in g) g.letterSpacing = '4px';
      g.fillText(laneNames[i][1], w / 2, 214);
    });
    textures.push(tex);
    const plate = mesh(new THREE.PlaneGeometry(0.42, 0.42), std('#ffffff', { map: tex, roughness: 0.4, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35 }), 0, 0.33, -0.252, b);
    plate.rotation.y = Math.PI;
    mesh(new THREE.TorusGeometry(0.16, 0.013, 8, 24, Math.PI), steel, 0, 0.55, -0.28, b);
    b.position.set(lx, 0, 0.6);
    shadow(b);
    const sub = ['aquababy', 'enfants', 'adultes'][i];
    b.userData = { station: 'nageurs', sub };
    scene.add(b);
    clickables.push({ root: b, station: 'nageurs', sub });
    anchors[`nageurs:${sub}`] = v3(lx, 1.05, 0.6);
  });
  anchors.nageurs = v3(0, 1.35, 0.6);

  /* ---------- 1 · trois lanternes flottantes (Ma méthode) ---------- */
  const orbGeo = new THREE.SphereGeometry(0.24, 48, 32);
  const poolGlowGeo = new THREE.CircleGeometry(1.15, 48);
  poolGlowGeo.rotateX(-Math.PI / 2);
  [
    { x: -2.5, color: '#FF9550', sub: 'sensation' },
    { x: 0, color: '#FFD9A0', sub: 'expression' },
    { x: 2.5, color: '#5562FF', sub: 'application' },
  ].forEach((d, i) => {
    const g = new THREE.Group();
    mesh(orbGeo, phys(d.color, { emissive: d.color, emissiveIntensity: 0.85, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 }), 0, 0.1, 0, g);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: d.color, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(2.4, 2.4, 1); halo.position.y = 0.1; halo.renderOrder = 8;
    const onWater = mesh(poolGlowGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: d.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.012, 0, g);
    onWater.renderOrder = 7;
    g.add(halo);
    g.position.set(d.x, POOL.water, -7.2 - (i === 1 ? 0.5 : 0));
    g.userData = { station: 'methode', sub: d.sub };
    scene.add(g);
    floaters.push({ obj: g, dy: 0, phase: i * 1.7, tilt: 0.02 });
    clickables.push({ root: g, station: 'methode', sub: d.sub });
    anchors[`methode:${d.sub}`] = v3(d.x, 0.85, g.position.z);
  });
  anchors.methode = v3(0, 1.25, -7.7);

  /* ---------- 2 · chaise de maître-nageur (Votre coach) ---------- */
  const chair = new THREE.Group();
  {
    const white = std('#2C2017', { roughness: 0.35, metalness: 0.4 });
    const teak = std(COLORS.teak, { roughness: 0.55 });
    const legGeo = new THREE.CylinderGeometry(0.03, 0.036, 1.62, 12);
    [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]].forEach(([x, z]) => {
      const l = mesh(legGeo, white, x * 1.08, 0.81, z * 1.08, chair);
      l.rotation.set(-z * 0.12, 0, x * 0.12);
    });
    for (let k = 0; k < 3; k++) mesh(rbox(0.66, 0.035, 0.09, 0.012), teak, 0, 0.42 + k * 0.38, -0.33, chair);
    mesh(rbox(0.72, 0.06, 0.6, 0.025, 3), teak, 0, 1.64, 0, chair);
    mesh(rbox(0.72, 0.56, 0.05, 0.022, 3), teak, 0, 1.97, 0.3, chair);
    const towelTex = canvasTexture(256, 384, (g, w, h) => {
      g.fillStyle = COLORS.majorelle; g.fillRect(0, 0, w, h);
      g.fillStyle = COLORS.orange; g.fillRect(0, h - 40, w, 4);
      if (logoImg) {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, 170, 54, 0, Math.PI * 2); g.fill();
        g.drawImage(logoImg, w / 2 - 58, 112, 116, 116);
      }
    });
    textures.push(towelTex);
    const towel = mesh(rbox(0.46, 0.8, 0.02, 0.008), std('#ffffff', { map: towelTex, roughness: 0.95 }), 0, 1.9, 0.27, chair);
    towel.rotation.x = 0.06;
    mesh(new THREE.CapsuleGeometry(0.025, 0.05, 4, 8), std(COLORS.navy), 0.3, 1.71, -0.1, chair).rotation.z = Math.PI / 2;
  }
  chair.position.set(5.0, 0, -7.6);
  chair.rotation.y = Math.PI / 2 + 0.25;
  shadow(chair);
  chair.userData = { station: 'coach' };
  scene.add(chair);
  clickables.push({ root: chair, station: 'coach' });
  anchors.coach = v3(5.0, 2.65, -7.6);

  /* ---------- 4 · échelle inox + planche (Le premier cours) ---------- */
  const ladder = new THREE.Group();
  [-0.3, 0.3].forEach((dz) => {
    const c = new THREE.CatmullRomCurve3([
      v3(-0.45, 0.0, dz), v3(-0.45, 0.62, dz), v3(-0.32, 0.85, dz), v3(-0.08, 0.82, dz), v3(0.06, 0.5, dz), v3(0.1, 0.0, dz), v3(0.1, -1.25, dz),
    ]);
    ladder.add(new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.024, 10), steel));
  });
  for (let k = 0; k < 3; k++) mesh(rbox(0.11, 0.035, 0.6, 0.012), steel, 0.13, -0.32 - k * 0.3, 0, ladder);
  ladder.position.set(-POOL.w / 2, 0, -3.3);
  shadow(ladder, true, false);
  ladder.userData = { station: 'premier-cours' };
  scene.add(ladder);
  clickables.push({ root: ladder, station: 'premier-cours' });

  const kick = new THREE.Group();
  {
    const s = new THREE.Shape();
    s.moveTo(-0.22, -0.3); s.lineTo(0.22, -0.3);
    s.lineTo(0.22, 0.12); s.quadraticCurveTo(0.22, 0.34, 0, 0.36); s.quadraticCurveTo(-0.22, 0.34, -0.22, 0.12); s.lineTo(-0.22, -0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 3, curveSegments: 18 });
    g.rotateX(-Math.PI / 2);
    kick.add(new THREE.Mesh(g, phys(COLORS.majorelle, { roughness: 0.6, clearcoat: 0.25 })));
    const stripe = mesh(new THREE.PlaneGeometry(0.44, 0.02), std(COLORS.orange), 0, 0.06, 0.05, kick);
    stripe.rotation.x = -Math.PI / 2;
  }
  kick.position.set(-2.55, POOL.water, -4.3);
  kick.rotation.y = 0.5;
  shadow(kick, true, false);
  kick.userData = { station: 'premier-cours' };
  scene.add(kick);
  floaters.push({ obj: kick, dy: 0, phase: 0.4, tilt: 0.05 });
  clickables.push({ root: kick, station: 'premier-cours' });
  anchors['premier-cours'] = v3(-3.6, 1.15, -3.4);
  scene.add(shadow(mesh(rbox(0.42, 0.06, 0.34, 0.025, 3), std(COLORS.cream, { roughness: 0.95 }), -4.6, 0.03, -4.25)));

  /* ---------- 5 · banc + serviettes pliées (Tarifs) ---------- */
  const bench = new THREE.Group();
  {
    const wood = std(COLORS.teak, { roughness: 0.55 });
    for (let k = 0; k < 3; k++) mesh(rbox(0.14, 0.045, 2.0, 0.015), wood, -0.16 + k * 0.16, 0.45, 0, bench);
    [-0.82, 0.82].forEach((z) => mesh(rbox(0.5, 0.43, 0.07, 0.015), concrete, 0, 0.215, z, bench));
    [['#EFE6D8'], ['#EFE6D8', COLORS.majorelle], ['#EFE6D8', COLORS.orange, COLORS.majorelle]].forEach((stack, si) => {
      stack.forEach((c, k) => {
        const t = mesh(rbox(0.4, 0.072, 0.34, 0.03, 3), std(c, { roughness: 0.95 }), 0, 0.51 + k * 0.075, -0.58 + si * 0.58, bench);
        t.rotation.y = k % 2 ? 0.04 : -0.03;
      });
    });
  }
  bench.position.set(5.0, 0, -12.2);
  shadow(bench);
  bench.userData = { station: 'tarifs' };
  scene.add(bench);
  clickables.push({ root: bench, station: 'tarifs' });
  anchors.tarifs = v3(5.0, 1.2, -12.2);

  /* ---------- 6 · écran du bassin (Avis), à gauche de la sortie ---------- */
  const board = new THREE.Group();
  const boardTex = canvasTexture(1536, 480, (g, w, h) => {
    g.fillStyle = '#0B1047'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < w; x += 8) g.fillRect(x, y, 3, 3);
    if (logoImg) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(150, 240, 104, 0, Math.PI * 2); g.fill();
      g.drawImage(logoImg, 40, 130, 220, 220);
    }
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = `700 64px ${FONT}`;
    g.fillText('MYLIZA SWIM', 300, 92);
    g.fillStyle = COLORS.orange; g.font = `600 30px ${FONT}`;
    g.fillText('I L S   O N T   P L O N G É   A V A N T   V O U S', 304, 150);
    [['1', 'AQUABABY', '3 MOIS – 1 AN'], ['2', 'ENFANTS', '1 – 9 ANS'], ['3', 'JEUNES & ADULTES', '9 ANS ET +']].forEach((r, i) => {
      const y = 230 + i * 74;
      g.fillStyle = COLORS.orange; g.font = `700 44px ${FONT}`; g.fillText(r[0], 304, y);
      g.fillStyle = '#ffffff'; g.font = `600 40px ${FONT}`; g.fillText(r[1], 360, y);
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `500 32px ${FONT}`; g.fillText(r[2], 820, y);
    });
    const d = new Date();
    g.textAlign = 'right';
    g.fillStyle = '#FF9A5C'; g.font = `600 128px ${FONT}`;
    g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, w - 70, 200);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `500 30px ${FONT}`;
    g.fillText('A V I S', w - 74, 320);
    g.textAlign = 'left';
  });
  textures.push(boardTex);
  mesh(rbox(3.6, 1.22, 0.1, 0.03, 3), std('#12162E', { roughness: 0.45, metalness: 0.3 }), 0, 0, 0, board);
  mesh(new THREE.PlaneGeometry(3.45, 1.08), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }), 0, 0, 0.052, board);
  board.position.set(-4.7, 1.9, HALL.far + 0.06);
  shadow(board, false, true);
  board.userData = { station: 'avis' };
  scene.add(board);
  clickables.push({ root: board, station: 'avis' });
  anchors.avis = v3(-4.7, 2.85, HALL.far + 0.1);

  /* ---------- 7 · bouée de sauvetage murale (FAQ), à droite de la sortie ---------- */
  const buoyStand = new THREE.Group();
  {
    mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI), steel, 0, 0.42, 0.06, buoyStand);
    const stripes = canvasTexture(512, 64, (g, w, h) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#F2EADF' : COLORS.majorelle; g.fillRect((i * w) / 8, 0, w / 8, h); }
    });
    const buoy = mesh(new THREE.TorusGeometry(0.34, 0.1, 24, 64), phys('#ffffff', { map: stripes, roughness: 0.4, clearcoat: 0.6 }), 0, 0, 0.14, buoyStand);
    buoy.name = 'buoy';
    mesh(new THREE.TorusGeometry(0.345, 0.012, 6, 64), std('#E9E2D6'), 0, 0, 0.14, buoyStand);
  }
  buoyStand.position.set(4.7, 1.55, HALL.far + 0.02);
  shadow(buoyStand);
  buoyStand.userData = { station: 'faq' };
  scene.add(buoyStand);
  clickables.push({ root: buoyStand, station: 'faq' });
  anchors.faq = v3(4.7, 2.3, HALL.far + 0.1);

  /* ---------- spots : chaque étape a sa flaque de lumière ---------- */
  spot(0, HALL.h - 0.1, 2.0, 0, 0, 0.6, { angle: 0.55, intensity: 55 });
  spot(4.3, HALL.h - 0.1, -6.6, 5.0, 0, -7.6, { castShadow: !low });
  spot(-3.1, HALL.h - 0.1, -2.6, -3.75, 0, -3.3, { intensity: 40 });
  if (!low) spot(4.3, HALL.h - 0.1, -11.2, 5.0, 0, -12.2, { intensity: 42 });
  if (!low) spot(4.0, HALL.h - 0.1, -17.4, 4.7, 1.4, -19.9, { intensity: 40, angle: 0.35 });

  /* ---------- transats dans les alcôves, plantes ---------- */
  const lounger = (x, z, ry) => {
    const g = new THREE.Group();
    const wood = std(COLORS.teak, { roughness: 0.55 });
    const cushionM = std('#C2AD92', { roughness: 0.95 });
    mesh(rbox(0.66, 0.07, 1.35, 0.025, 3), wood, 0, 0.3, 0.2, g);
    mesh(rbox(0.66, 0.07, 0.7, 0.025, 3), wood, 0, 0.5, -0.72, g).rotation.x = 0.62;
    mesh(rbox(0.6, 0.08, 1.3, 0.035, 3), cushionM, 0, 0.37, 0.2, g);
    mesh(rbox(0.6, 0.08, 0.66, 0.035, 3), cushionM, 0, 0.56, -0.68, g).rotation.x = 0.62;
    mesh(rbox(0.42, 0.05, 0.3, 0.02), std(COLORS.majorelle, { roughness: 0.95 }), 0, 0.435, 0.55, g);
    [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.3], [0.28, -0.3]].forEach(([lx, lz]) => mesh(rbox(0.05, 0.28, 0.05, 0.01), wood, lx, 0.14, lz, g));
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(shadow(g));
  };
  [-4.5, -10.5, -16.5].forEach((z) => { lounger(-7.7, z, Math.PI / 2); lounger(7.7, z, -Math.PI / 2); });

  const plant = (x, z, s = 1, parent = scene) => {
    const g = new THREE.Group();
    mesh(rbox(0.62, 0.66, 0.62, 0.04, 3), concrete, 0, 0.33, 0, g);
    mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.9, 8), std('#6B523E'), 0, 1.05, 0, g);
    mesh(new THREE.SphereGeometry(0.44, 48, 32), leafM, 0, 1.72, 0, g);
    g.position.set(x, 0, z); g.scale.setScalar(s);
    parent.add(shadow(g));
  };
  plant(-8.2, -1.2, 0.95); plant(8.2, -1.2, 0.95); plant(-8.2, -19.0, 0.95); plant(8.2, -19.0, 0.95);

  /* ==================================================================
     LE SALON D'ACCUEIL
  ================================================================== */
  const lounge = new THREE.Group();
  {
    const LZ0 = HALL.near, LZ1 = LOUNGE.back, LW = LOUNGE.x * 2, LD = LZ1 - LZ0, LM = (LZ0 + LZ1) / 2;
    // parquet chêne fumé
    const woodTex = canvasTexture(512, 512, (g, w, h) => {
      const rows = 8, ph = h / rows;
      for (let r = 0; r < rows; r++) {
        let x = (r % 2) * -w * 0.37;
        while (x < w) {
          const len = w * rnd(0.45, 0.85);
          const b = rnd(88, 118);
          g.fillStyle = `rgb(${b + 18},${Math.round(b * 0.68 + 6)},${Math.round(b * 0.45)})`;
          g.fillRect(x, r * ph, len, ph);
          for (let k = 0; k < 16; k++) { g.fillStyle = `rgba(40,24,12,${rnd(0, 0.12)})`; g.fillRect(x, r * ph + Math.random() * ph, len, rnd(1, 2)); }
          g.fillStyle = 'rgba(28,16,8,0.55)'; g.fillRect(x, r * ph, 2, ph);
          x += len;
        }
        g.fillStyle = 'rgba(25,15,8,0.6)'; g.fillRect(0, r * ph, w, 2);
      }
    }, { repeat: [LW / 2.6, LD / 2.6] });
    const fl = mesh(new THREE.PlaneGeometry(LW, LD), std('#9C8577', { map: woodTex, roughness: 0.42 }), 0, 0.002, LM, lounge);
    fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true;
    // murs grège, plafond à caisson
    const greige = std('#4E3B2E', { roughness: 0.9 });
    [-1, 1].forEach((s) => { const w = mesh(new THREE.PlaneGeometry(LD, LOUNGE.h), greige, s * LOUNGE.x, LOUNGE.h / 2, LM, lounge); w.rotation.y = -s * Math.PI / 2; w.receiveShadow = true; });
    const back = mesh(new THREE.PlaneGeometry(LW, LOUNGE.h), greige, 0, LOUNGE.h / 2, LZ1, lounge); back.rotation.y = Math.PI;
    const lc = mesh(new THREE.PlaneGeometry(LW, LD), std('#2E2219', { roughness: 0.95 }), 0, LOUNGE.h, LM, lounge); lc.rotation.x = Math.PI / 2;
    const coffer = mesh(new THREE.PlaneGeometry(7, 5.6), std('#3A2B20', { roughness: 0.95 }), -0.6, LOUNGE.h - 0.12, LM + 0.2, lounge); coffer.rotation.x = Math.PI / 2;
    // caisson du plafond : gorge lumineuse bleu Majorelle
    [[-0.6 - 3.5, 0], [-0.6 + 3.5, 0]].forEach(([x]) => mesh(new THREE.BoxGeometry(0.04, 0.04, 5.6), ledBlueM, x, LOUNGE.h - 0.1, LM + 0.2, lounge));
    [LM + 0.2 - 2.8, LM + 0.2 + 2.8].forEach((z) => mesh(new THREE.BoxGeometry(7, 0.04, 0.04), ledBlueM, -0.6, LOUNGE.h - 0.1, z, lounge));
    const cove = mesh(new THREE.PlaneGeometry(7.6, 6.2), new THREE.MeshBasicMaterial({ map: glowTex, color: '#3F4BFF', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), -0.6, LOUNGE.h - 0.13, LM + 0.2, lounge);
    cove.rotation.x = Math.PI / 2;
    for (let x = -5.5; x <= 5.5; x += 2.2) for (let z = LZ0 + 1.4; z < LZ1; z += 2.4) {
      if (Math.abs(x + 0.6) < 3.4 && Math.abs(z - LM - 0.2) < 2.7) continue;
      mesh(new THREE.CircleGeometry(0.06, 16), downM, x, LOUNGE.h - 0.005, z, lounge).rotation.x = Math.PI / 2;
      lightPool(x, z, 0.9, 0.9, '#FFB070', 0.16, 0.01, lounge);
    }

    // bibliothèque intégrée + cheminée + écran (mur gauche)
    const unitM = std('#3E2E22', { roughness: 0.55 });
    const nicheM = std('#1E1610', { roughness: 0.9 });
    const ux = -LOUNGE.x + 0.24, uz0 = 5.4, uz1 = 12.0, uh = 3.0;
    mesh(new THREE.BoxGeometry(0.06, uh, uz1 - uz0), nicheM, -LOUNGE.x + 0.03, uh / 2, (uz0 + uz1) / 2, lounge);
    for (let z = uz0; z <= uz1 + 0.01; z += (uz1 - uz0) / 4) mesh(new THREE.BoxGeometry(0.46, uh, 0.08), unitM, ux, uh / 2, z, lounge);
    [0.06, 1.05, 2.0, uh - 0.05].forEach((y) => {
      [[uz0, uz0 + 1.65], [uz1 - 1.65, uz1]].forEach(([a, b]) => {
        mesh(new THREE.BoxGeometry(0.46, 0.06, b - a), unitM, ux, y, (a + b) / 2, lounge);
        // réglette ambrée sous chaque tablette
        if (y > 0.5) mesh(new THREE.BoxGeometry(0.02, 0.012, b - a - 0.1), ledM, ux + 0.2, y - 0.036, (a + b) / 2, lounge);
      });
    });
    const fz = (uz0 + uz1) / 2;
    mesh(new THREE.BoxGeometry(0.46, uh, 3.3), unitM, ux + 0.02, uh / 2, fz, lounge);
    mesh(new THREE.BoxGeometry(0.1, 0.62, 1.3), std('#15110E'), ux + 0.2, 0.55, fz, lounge);
    const fireTex = canvasTexture(256, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, h, 0, 0);
      grd.addColorStop(0, 'rgba(255,170,70,1)'); grd.addColorStop(0.5, 'rgba(255,110,30,0.75)'); grd.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = grd;
      for (let i = 0; i < 9; i++) {
        const x = 20 + i * 26 + rnd(-6, 6), hh = rnd(50, 110);
        g.beginPath(); g.moveTo(x - 16, h); g.quadraticCurveTo(x - 10, h - hh * 0.6, x, h - hh); g.quadraticCurveTo(x + 10, h - hh * 0.6, x + 16, h); g.fill();
      }
    });
    const fire = mesh(new THREE.PlaneGeometry(1.1, 0.5), new THREE.MeshBasicMaterial({ map: fireTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), ux + 0.26, 0.5, fz, lounge);
    fire.rotation.y = Math.PI / 2;
    fire.name = 'fire';
    mesh(new THREE.BoxGeometry(0.5, 0.08, 1.9), std('#8C7764', { roughness: 0.4 }), ux + 0.04, 0.9, fz, lounge);
    lightPool(ux + 1.1, fz, 1.6, 1.2, '#FF8A3A', 0.35, 0.012, lounge);
    const tvTex = canvasTexture(512, 288, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#141A5E'); grd.addColorStop(0.6, '#3B3FA8'); grd.addColorStop(1, '#C97A64');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      if (logoImg) {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, h / 2 - 16, 50, 0, Math.PI * 2); g.fill();
        g.drawImage(logoImg, w / 2 - 54, h / 2 - 70, 108, 108);
      }
      g.fillStyle = '#ffffff'; g.font = `700 26px ${FONT}`; g.textAlign = 'center';
      g.fillText('MYLIZA SWIM', w / 2, h - 46);
    });
    textures.push(tvTex);
    const tv = mesh(new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }), ux + 0.26, 1.85, fz, lounge);
    tv.rotation.y = Math.PI / 2;
    // objets sur les étagères
    const decoM = [std('#C9B79C'), std('#3E3A36'), std('#B07A45'), std('#E9E2D6')];
    [[uz0 + 0.4, 1.1], [uz0 + 1.1, 2.05], [uz1 - 0.5, 1.1], [uz1 - 1.2, 2.05], [uz0 + 0.8, 0.11], [uz1 - 0.9, 0.11]].forEach(([z, y], k) => {
      if (k % 2) mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 20), decoM[k % 4], ux + 0.06, y + 0.15, z, lounge);
      else for (let b = 0; b < 5; b++) mesh(new THREE.BoxGeometry(0.2, rnd(0.22, 0.3), 0.04), decoM[(b + k) % 4], ux + 0.06, y + 0.13, z + b * 0.05, lounge);
    });

    // tapis rond
    const rugTex = canvasTexture(512, 512, (g, w) => {
      g.fillStyle = '#7E6A58'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0, 0.08)})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
      g.strokeStyle = 'rgba(80,65,50,0.35)'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 22, 0, Math.PI * 2); g.stroke();
    });
    const rug = mesh(new THREE.CircleGeometry(2.4, 64), std('#ffffff', { map: rugTex, roughness: 1, transparent: true }), -2.7, 0.006, 8.6, lounge);
    rug.rotation.x = -Math.PI / 2; rug.receiveShadow = true;

    // canapés cuir cognac
    const leather = phys('#A8693A', { roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.3 });
    const sofa = (len, x, z, ry) => {
      const g = new THREE.Group();
      mesh(rbox(len, 0.3, 0.92, 0.06, 3), leather, 0, 0.24, 0, g);
      for (let k = 0; k < 2; k++) mesh(rbox(len / 2 - 0.25, 0.16, 0.74, 0.07, 3), leather, (k ? 1 : -1) * (len / 4 - 0.06), 0.46, 0.05, g);
      mesh(rbox(len, 0.5, 0.22, 0.08, 3), leather, 0, 0.62, -0.35, g);
      [-1, 1].forEach((s) => mesh(rbox(0.22, 0.58, 0.92, 0.07, 3), leather, s * (len / 2 - 0.11), 0.4, 0, g));
      [-1, 1].forEach((s) => [-1, 1].forEach((t) => mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.1, 8), bronze, s * (len / 2 - 0.12), 0.05, t * 0.36, g)));
      const pM = [std('#9C3E2C', { roughness: 0.95 }), std('#D3A35E', { roughness: 0.95 })];
      [-1, 1].forEach((s, k) => { const p = mesh(rbox(0.42, 0.4, 0.13, 0.06, 3), pM[k], s * (len / 2 - 0.45), 0.72, -0.18, g); p.rotation.set(-0.2, s * 0.15, s * 0.08); });
      g.position.set(x, 0, z); g.rotation.y = ry;
      lounge.add(shadow(g));
    };
    sofa(2.5, -5.0, 8.6, Math.PI / 2);
    sofa(2.3, -2.5, 6.1, 0);
    // table basse
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 48), std('#2B241F', { roughness: 0.3 }), -2.7, 0.4, 8.5, lounge).castShadow = true;
    mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.36, 32), std('#B08D57', { roughness: 0.3, metalness: 0.7 }), -2.7, 0.19, 8.5, lounge);
    mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.16, 24), std('#E9E2D6'), -2.5, 0.51, 8.4, lounge);
    // fauteuils velours marine
    const velvet = phys('#2A35C8', { roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#7C86FF'), sheenRoughness: 0.45 });
    const armchair = (x, z, tx, tz) => {
      const ry = Math.atan2(-(tz - z), tx - x);
      const g = new THREE.Group();
      const prof = [[0.0, 0.18], [0.36, 0.18], [0.42, 0.26], [0.44, 0.5], [0.46, 0.78], [0.42, 0.82], [0.38, 0.78], [0.36, 0.5], [0.34, 0.36]].map(([r, y]) => new THREE.Vector2(r, y));
      const shell = mesh(new THREE.LatheGeometry(prof, 40, Math.PI * 0.7, Math.PI * 1.6), velvet, 0, 0, 0, g);
      shell.material.side = THREE.DoubleSide;
      mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.14, 40), velvet, 0, 0.4, 0, g);
      [0, 1, 2, 3].forEach((k) => { const a = k * Math.PI / 2 + Math.PI / 4; const l = mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.2, 8), std('#15130F', { metalness: 0.6, roughness: 0.3 }), Math.cos(a) * 0.3, 0.09, Math.sin(a) * 0.3, g); l.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); });
      g.position.set(x, 0, z); g.rotation.y = ry;
      lounge.add(shadow(g));
    };
    armchair(-1.0, 7.5, -2.7, 8.5);
    armchair(-1.0, 9.5, -2.7, 8.5);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 32), phys('#C08A33', { roughness: 0.8, sheen: 0.6 }), 1.2, 0.21, 5.9, lounge).castShadow = true;

    // colonne marine
    mesh(rbox(0.5, LOUNGE.h, 0.5, 0.02), std('#1B2276', { roughness: 0.5 }), 2.6, LOUNGE.h / 2, 7.4, lounge).castShadow = true;

    // bar à droite : bois sombre, plateau pierre, jardinière, suspensions
    const barM = std('#2A1C14', { roughness: 0.4 });
    // fond de bar rétroéclairé orange
    mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: washTex, color: '#FF8E45', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }), LOUNGE.x - 0.02, 2.2, 8.3, lounge).rotation.y = -Math.PI / 2;
    mesh(rbox(0.72, 1.05, 6.2, 0.03), barM, 5.3, 0.525, 8.3, lounge).castShadow = true;
    mesh(rbox(0.86, 0.06, 6.4, 0.02), std('#D8CFC2', { roughness: 0.35 }), 5.3, 1.08, 8.3, lounge);
    const planter = mesh(rbox(0.4, 0.34, 5.8, 0.15, 3), leafM, 5.45, 1.28, 8.3, lounge);
    planter.castShadow = true;
    for (let k = 0; k < 3; k++) {
      const z = 6.4 + k * 1.9;
      mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.0, 4), std('#111'), 4.9, 2.9, z, lounge);
      mesh(new THREE.SphereGeometry(0.11, 24, 16), new THREE.MeshBasicMaterial({ color: '#FFD9A6' }), 4.9, 2.35, z, lounge);
      mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 20), std('#2B2420', { roughness: 0.4 }), 4.6, 0.36, z, lounge);
    }
    plant(-6.1, 4.3, 1.0, lounge);
    plant(6.2, 12.9, 1.0, lounge);
    plant(-6.1, 13.2, 0.9, lounge);

    // lampadaire près du canapé
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), bronze, -5.9, 0.75, 10.6, lounge);
    mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 24), bronze, -5.9, 0.01, 10.6, lounge);
    mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.32, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#F3D9B4', emissive: '#FFB566', emissiveIntensity: 1.1, side: THREE.DoubleSide }), -5.9, 1.62, 10.6, lounge);
    lightPool(-5.6, 10.4, 1.4, 1.4, '#FFB070', 0.25, 0.012, lounge);

    // lumière chaude et tamisée du salon
    const fireLight = new THREE.PointLight('#FF8A3A', 4, 7, 1.5);
    fireLight.position.set(ux + 0.7, 0.7, fz);
    fireLight.name = 'fireLight';
    lounge.add(fireLight);
    if (!low) {
      const lampLight = new THREE.PointLight('#FFB566', 3.2, 6, 1.5);
      lampLight.position.set(-5.9, 1.6, 10.6);
      lounge.add(lampLight);
    }
    // un spot au-dessus de la table basse, avec ombres portées sur le tapis
    spot(-2.4, LOUNGE.h - 0.05, 8.8, -2.7, 0, 8.4, { intensity: 22, angle: 0.75, beam: false, castShadow: !low, parent: lounge });
    if (!low) spot(4.9, LOUNGE.h - 0.05, 8.3, 5.3, 1.1, 8.3, { intensity: 16, angle: 0.9, beam: false, color: '#FFB677', parent: lounge });
  }
  scene.add(lounge);
  const fireMesh = lounge.getObjectByName('fire');
  const fireLight = lounge.getObjectByName('fireLight');

  /* ==================================================================
     LA TERRASSE (fin de la visite : prendre contact)
  ================================================================== */
  const terrace = new THREE.Group();
  {
    const TZ0 = HALL.far, TZ1 = -46, TW = 30;
    const paverTex = canvasTexture(512, 512, (g, w, h) => {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const v = rnd(-7, 7);
        g.fillStyle = `rgb(${176 + v},${154 + v},${126 + v})`;
        g.fillRect(i * w / 4, j * h / 4, w / 4, h / 4);
      }
      for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,100,70,${rnd(0.02, 0.08)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = 'rgba(150,135,110,0.9)';
      for (let k = 0; k <= 4; k++) { g.fillRect(k * w / 4 - 1, 0, 2, h); g.fillRect(0, k * h / 4 - 1, w, 2); }
    }, { repeat: [TW / 2.4, (TZ0 - TZ1) / 2.4] });
    const ground = mesh(new THREE.PlaneGeometry(TW, TZ0 - TZ1), std('#ffffff', { map: paverTex, roughness: 0.85 }), 0, 0.001, (TZ0 + TZ1) / 2, terrace);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    const dark = mesh(new THREE.PlaneGeometry(7, 12), std('#6E6A63', { roughness: 0.9 }), -10.5, 0.004, -27, terrace);
    dark.rotation.x = -Math.PI / 2; dark.receiveShadow = true;
    const lawnTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#6B8C48'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) { g.fillStyle = Math.random() > 0.5 ? 'rgba(150,180,90,0.25)' : 'rgba(40,70,30,0.25)'; g.fillRect(Math.random() * w, Math.random() * h, 1, rnd(2, 5)); }
    }, { repeat: [6, 4] });
    const lawn = mesh(new THREE.PlaneGeometry(11, 12), std('#ffffff', { map: lawnTex, roughness: 1 }), 9, 0.006, -38, terrace);
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true;
    // clôture en lames de bois
    const slatGeo = new THREE.BoxGeometry(0.09, 1.7, 0.05);
    const slats = new THREE.InstancedMesh(slatGeo, std('#A5714A', { roughness: 0.7 }), 150);
    for (let i = 0; i < 150; i++) { dummy.position.set(-15 + i * 0.125, 0.85, -40); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); slats.setMatrixAt(i, dummy.matrix); }
    slats.castShadow = true; slats.receiveShadow = true;
    terrace.add(slats);
    mesh(new THREE.BoxGeometry(18.8, 0.06, 0.12), std('#7A5236'), -5.6, 1.72, -40, terrace);
    // arbres
    const trunkM = std('#3A2A1F', { roughness: 0.9 });
    const duskLeaf = std('#6A7458', { map: leafTex, roughness: 0.95 });
    const tree = (x, z, s, conifer) => {
      const g = new THREE.Group();
      mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 10), trunkM, 0, 1.2, 0, g);
      if (conifer) {
        [[1.9, 2.2, 3.1], [1.5, 2.0, 4.6], [1.0, 1.8, 6.0]].forEach(([r, h, y]) => mesh(new THREE.ConeGeometry(r, h, 18), duskLeaf, 0, y, 0, g));
      } else {
        [[0, 4.2, 0, 1.9], [1.0, 3.6, 0.4, 1.3], [-1.0, 3.7, -0.3, 1.4], [0.2, 5.2, -0.2, 1.3]].forEach(([dx, y, dz, r]) => mesh(new THREE.SphereGeometry(r, 28, 20), duskLeaf, dx, y, dz, g));
      }
      g.position.set(x, 0, z); g.scale.setScalar(s);
      terrace.add(shadow(g, true, false));
    };
    [[-13, -44, 1.1, true], [-9, -45, 1.2, false], [-5, -44.5, 1.0, true], [-1, -45.5, 1.3, false], [3, -44.5, 1.1, true], [7, -45, 1.2, false], [11, -44, 1.0, true], [14, -42, 1.1, false], [-15, -36, 1.0, false]].forEach(([x, z, s, c]) => tree(x, z, s, c));

    // tables et fauteuils tressés
    const wickerTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#B7A58A'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,70,45,0.45)'; g.lineWidth = 2;
      for (let i = -h; i < w; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); }
    }, { repeat: [8, 3] });
    const wicker = std('#ffffff', { map: wickerTex, roughness: 0.9, side: THREE.DoubleSide });
    const cushion = std('#E2D7C4', { roughness: 0.95 });
    const legM = std('#3A332C', { roughness: 0.5, metalness: 0.3 });
    const tubChair = (x, z, ry) => {
      const g = new THREE.Group();
      const prof = [[0.3, 0.12], [0.36, 0.3], [0.39, 0.55], [0.4, 0.72], [0.37, 0.75], [0.35, 0.55], [0.32, 0.3]].map(([r, y]) => new THREE.Vector2(r, y));
      mesh(new THREE.LatheGeometry(prof, 36, Math.PI * 0.75, Math.PI * 1.5), wicker, 0, 0, 0, g);
      mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 32), cushion, 0, 0.36, 0, g);
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 32, 1, true), wicker, 0, 0.22, 0, g);
      [0, 1, 2, 3].forEach((k) => { const a = k * Math.PI / 2 + Math.PI / 4; mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), legM, Math.cos(a) * 0.24, 0.07, Math.sin(a) * 0.24, g); });
      g.position.set(x, 0, z); g.rotation.y = ry;
      terrace.add(shadow(g));
    };
    const table = (x, z, n) => {
      const g = new THREE.Group();
      mesh(rbox(0.82, 0.04, 0.82, 0.01), std('#2E2620', { roughness: 0.35 }), 0, 0.74, 0, g);
      // photophore : verre ambré allumé
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20), new THREE.MeshStandardMaterial({ color: '#FFD3A0', emissive: '#FF9A4A', emissiveIntensity: 1.6, transparent: true, opacity: 0.9 }), -0.15, 0.82, -0.1, g);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#FF9A4A', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(0.7, 0.7, 1); glow.position.set(-0.15, 0.84, -0.1); g.add(glow);
      lightPool(0, 0, 1.3, 1.3, '#FF9A4A', 0.18, 0.012, g);
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 10), legM, 0, 0.37, 0, g);
      mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.03, 24), legM, 0, 0.015, 0, g);
      mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 16), std('#F1ECE3'), 0.1, 0.81, 0.05, g);
      mesh(new THREE.SphereGeometry(0.09, 16, 12), leafM, 0.1, 0.9, 0.05, g);
      g.position.set(x, 0, z);
      terrace.add(shadow(g));
      for (let k = 0; k < n; k++) {
        const a = k * (Math.PI * 2 / n) + 0.4;
        // le dossier (ouverture à l'opposé) regarde vers la table
        tubChair(x + Math.cos(a) * 0.82, z + Math.sin(a) * 0.82, Math.PI - a);
      }
    };
    [[-3.4, -25.8, 3], [1.4, -27.6, 4], [5.4, -25.0, 3], [-2.0, -31.8, 4], [3.6, -32.6, 3], [-7.0, -29.0, 3], [8.6, -30.0, 3]].forEach(([x, z, n]) => table(x, z, n));
    // guirlande de lumières chaudes au-dessus des tables
    const bulbGeo = new THREE.SphereGeometry(0.045, 12, 8);
    const bulbM = new THREE.MeshBasicMaterial({ color: '#FFC27E' });
    [[[-9, 3.2, -22.5], [9, 3.2, -24.5]], [[-9, 3.2, -30.5], [9, 3.2, -33.5]]].forEach(([a, b]) => {
      [a, b].forEach(([x, y, z]) => mesh(new THREE.CylinderGeometry(0.05, 0.06, y, 10), bronze, x, y / 2, z, terrace));
      const c = new THREE.QuadraticBezierCurve3(v3(...a), v3((a[0] + b[0]) / 2, 2.4, (a[2] + b[2]) / 2), v3(...b));
      terrace.add(new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.006, 4), std('#1A1410')));
      const n = 22;
      const inst = new THREE.InstancedMesh(bulbGeo, bulbM, n);
      const glowPts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const q = c.getPoint((i + 0.5) / n);
        dummy.position.set(q.x, q.y - 0.08, q.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        glowPts.set([q.x, q.y - 0.08, q.z], i * 3);
      }
      terrace.add(inst);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(glowPts, 3));
      terrace.add(new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, color: '#FFAA5C', size: 0.55, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })));
    });

    // jardinières basses le long de la terrasse
    [[-12.5, -23], [12.5, -23], [-12.5, -32], [12.5, -26]].forEach(([x, z]) => {
      mesh(rbox(1.6, 0.5, 0.6, 0.04), concrete, x, 0.25, z, terrace);
      mesh(rbox(1.5, 0.4, 0.5, 0.18, 3), leafM, x, 0.62, z, terrace);
    });
  }
  scene.add(terrace);

  /* ---------- sous l'eau : rayons de lumière et bulles ---------- */
  const under = new THREE.Group();
  under.visible = false;
  const rayTex = canvasTexture(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const s = g.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = s; g.fillRect(0, 0, w, h);
  });
  const rays = [];
  for (let i = 0; i < 16; i++) {
    const r = mesh(new THREE.PlaneGeometry(rnd(0.25, 0.6), 1.5), new THREE.MeshBasicMaterial({ map: rayTex, color: '#B9C4FF', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), rnd(-3.4, 1.0), POOL.water - 0.75, rnd(-8, -1.2), under);
    r.rotation.set(0, rnd(0, Math.PI), rnd(-0.25, 0.25));
    r.userData.phase = Math.random() * 6;
    r.renderOrder = 9;
    rays.push(r);
  }
  const NB = 70;
  const bubPos = new Float32Array(NB * 3);
  const bubSeed = [];
  for (let i = 0; i < NB; i++) { bubSeed.push({ x: rnd(-3.4, 0.5), z: rnd(-6.5, -1.5), s: rnd(0.25, 0.6), o: Math.random() }); }
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  const bubTex = canvasTexture(64, 64, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(24, 24, 6, 0, Math.PI * 2); g.fill();
  });
  const bubbles = new THREE.Points(bubGeo, new THREE.PointsMaterial({ size: 0.045, map: bubTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  bubbles.frustumCulled = false;
  under.add(bubbles);
  scene.add(under);
  // le brouillard existe toujours (pas de recompilation des shaders) : densité nulle hors de l'eau
  const uwFog = new THREE.FogExp2('#0C1460', 0);
  scene.fog = uwFog;

  /* ---------- le dauphin de verre ---------- */
  const swim = { uPhase: { value: 0 }, uAmp: { value: 0.025 } };
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF', metalness: 0, roughness: 0.03,
    transmission: 1, thickness: 0.55, ior: 1.5, dispersion: 2,
    attenuationColor: new THREE.Color('#6E7BFF'), attenuationDistance: 0.9,
    clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 0.45, iridescenceIOR: 1.3,
    specularIntensity: 1, envMapIntensity: 1.8,
  });
  glass.onBeforeCompile = (sh) => {
    sh.uniforms.uPhase = swim.uPhase;
    sh.uniforms.uAmp = swim.uAmp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPhase;\nuniform float uAmp;')
      .replace('#include <beginnormal_vertex>', /* glsl */`#include <beginnormal_vertex>
        // ondulation dorso-ventrale : nulle à la tête, maximale à la caudale
        float sw = clamp((0.22 - position.x) / 0.72, 0.0, 1.0);
        float ww = sw * sw;
        float ph = uPhase - position.x * 5.5;
        float fy = uAmp * ww * sin(ph);
        float dsw = (sw > 0.0 && sw < 1.0) ? -1.0 / 0.72 : 0.0;
        float dfdx = uAmp * (2.0 * sw * dsw * sin(ph) + ww * cos(ph) * (-5.5));
        objectNormal.x -= dfdx * objectNormal.y;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += fy;');
  };
  glass.customProgramCacheKey = () => 'mls-dolphin';
  const dolphin = buildDolphin(glass);
  dolphin.swim = swim;
  dolphin.root.scale.setScalar(1.4);
  scene.add(dolphin.root);

  /* ---------- éclaboussures & ondes ---------- */
  const ripples = [];
  const rippleGeo = new THREE.RingGeometry(0.86, 1.0, 64);
  rippleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 10; i++) {
    const m = mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.renderOrder = 6;
    scene.add(m);
    ripples.push({ m, t: 1, life: 1.6 });
  }
  function ripple(x, z, size = 1, delay = 0) {
    const r = ripples.find((q) => q.t >= 1) || ripples[0];
    r.t = -delay / r.life; r.size = size;
    r.m.position.set(x, state.level + 0.01, z);
  }
  const DROPS = 220;
  const dropPos = new Float32Array(DROPS * 3);
  const dropVel = new Float32Array(DROPS * 3);
  const dropLife = new Float32Array(DROPS).fill(0);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ size: 0.08, map: glowTex, transparent: true, depthWrite: false, color: '#ffffff' }));
  drops.frustumCulled = false; drops.renderOrder = 7;
  scene.add(drops);
  let dropCursor = 0;
  function splash(x, z, n = 40, power = 1) {
    for (let k = 0; k < n; k++) {
      const i = dropCursor; dropCursor = (dropCursor + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.6, 2.0) * power;
      dropPos.set([x + Math.cos(a) * 0.15, state.level + 0.03, z + Math.sin(a) * 0.15], i * 3);
      dropVel.set([Math.cos(a) * sp, rnd(2.0, 4.4) * power, Math.sin(a) * sp], i * 3);
      dropLife[i] = 1;
    }
    ripple(x, z, 1.2 * power);
    ripple(x, z, 0.8 * power, 0.25);
  }
  function updateFx(dt) {
    ripples.forEach((r) => {
      if (r.t >= 1) { r.m.visible = false; return; }
      r.t += dt / r.life;
      if (r.t < 0) { r.m.visible = false; return; }
      const k = Math.min(r.t, 1);
      r.m.visible = true;
      r.m.position.y = state.level + 0.012;
      r.m.scale.setScalar((0.15 + k * 1.6) * (r.size || 1));
      r.m.material.opacity = (1 - k) * 0.5;
    });
    for (let i = 0; i < DROPS; i++) {
      if (dropLife[i] <= 0) { dropPos[i * 3 + 1] = -50; continue; }
      dropVel[i * 3 + 1] -= 9.8 * dt;
      dropPos[i * 3] += dropVel[i * 3] * dt;
      dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
      dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
      if (dropPos[i * 3 + 1] < state.level) dropLife[i] = 0;
    }
    dropGeo.attributes.position.needsUpdate = true;
  }

  /* ---------- logo et polices (asynchrone) ---------- */
  const ready = Promise.all([
    loadImage('assets/img/logo-mark.svg').then((img) => { logoImg = img; }),
    document.fonts ? document.fonts.ready : Promise.resolve(),
  ]).then(() => textures.forEach((t) => t.userData.redraw()));
  const clockTimer = setInterval(() => boardTex.userData.redraw(), 30000);

  function setFill(f) {
    state.fill = f;
    state.level = THREE.MathUtils.lerp(POOL.floor + 0.02, POOL.water, f);
    water.position.y = state.level;
    waterMat.uniforms.uFill.value = THREE.MathUtils.smoothstep(f, 0, 0.12);
  }

  /* ---------- boucle ---------- */
  const camPos = new THREE.Vector3();
  function update(t, dt, camera) {
    state.time = t;
    waterMat.uniforms.uTime.value = t;
    causticMat.uniforms.uTime.value = t;
    updateRopes(t);
    floaters.forEach((f) => {
      const o = f.obj;
      o.position.y = state.level + f.dy + Math.sin(t * 1.4 + f.phase) * 0.025;
      o.rotation.x = Math.sin(t * 1.1 + f.phase) * f.tilt;
      o.rotation.z = Math.cos(t * 0.9 + f.phase) * f.tilt;
    });
    const b = buoyStand.getObjectByName('buoy');
    if (b) b.rotation.z = Math.sin(t * 0.6) * 0.03;
    if (fireMesh) {
      const fl = 0.8 + Math.sin(t * 9.0) * 0.08 + Math.sin(t * 13.7) * 0.06 + Math.sin(t * 4.1) * 0.05;
      fireMesh.material.opacity = fl;
      fireMesh.scale.y = 0.9 + fl * 0.15;
      fireLight.intensity = 2.0 + fl * 0.8;
    }
    updateFx(dt);

    // sous l'eau ?
    if (camera) {
      camera.getWorldPosition(camPos);
      const uw = camPos.y < state.level - 0.015 && Math.abs(camPos.x) < POOL.w / 2 && camPos.z < 0 && camPos.z > -POOL.l;
      if (uw !== state.underwater) {
        state.underwater = uw;
        uwFog.density = uw ? 0.2 : 0;
        under.visible = uw;
      }
      if (uw) {
        rays.forEach((r) => { r.material.opacity = 0.07 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.8 + r.userData.phase)); r.rotation.z = Math.sin(t * 0.3 + r.userData.phase) * 0.2; });
        for (let i = 0; i < NB; i++) {
          const s = bubSeed[i];
          const k = (s.o + t * s.s * 0.35) % 1;
          bubPos[i * 3] = s.x + Math.sin(t * 2 + i) * 0.03;
          bubPos[i * 3 + 1] = POOL.floor + 0.05 + k * (state.level - POOL.floor - 0.08);
          bubPos[i * 3 + 2] = s.z + Math.cos(t * 1.7 + i) * 0.03;
        }
        bubGeo.attributes.position.needsUpdate = true;
      }
    }
  }

  return {
    scene, update, ready, clickables, anchors, dolphin, splash, ripple, setFill, state, POOL,
    stop: () => clearInterval(clockTimer),
  };
}

/* ==================================================================
   Dauphin procédural : corps à sections elliptiques (dos, ventre et
   flancs distincts), melon, rostre, nageoires falciformes. Tout est
   cuit dans le repère du corps pour que l'ondulation du shader
   entraîne aussi la caudale.
================================================================== */
function buildDolphin(material) {
  const root = new THREE.Group();
  const pitch = new THREE.Group();
  root.add(pitch);
  const body = new THREE.Group();
  pitch.add(body);

  // t (queue → rostre), demi-largeur, dos, ventre, décalage vertical
  const K = [
    [0.0, 0.012, 0.024, 0.024, 0.0],
    [0.06, 0.024, 0.052, 0.046, 0.0],
    [0.18, 0.048, 0.088, 0.076, 0.0],
    [0.32, 0.09, 0.126, 0.11, 0.0],
    [0.47, 0.132, 0.152, 0.138, 0.0],
    [0.6, 0.146, 0.158, 0.146, 0.0],
    [0.72, 0.134, 0.146, 0.13, 0.0],
    [0.8, 0.112, 0.13, 0.104, 0.006],
    [0.86, 0.086, 0.1, 0.078, 0.01],
    [0.895, 0.054, 0.052, 0.06, -0.012],
    [0.93, 0.038, 0.03, 0.042, -0.024],
    [0.97, 0.026, 0.02, 0.028, -0.03],
    [1.0, 0.002, 0.002, 0.002, -0.034],
  ];
  const interp = (t, c) => {
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const p0 = K[Math.max(i - 1, 0)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(i + 2, K.length - 1)];
    const t1 = p1[0], t2 = p2[0];
    const u = (t - t1) / (t2 - t1);
    const m1 = (p2[c] - p0[c]) / Math.max(p2[0] - p0[0], 1e-4) * (t2 - t1);
    const m2 = (p3[c] - p1[c]) / Math.max(p3[0] - p1[0], 1e-4) * (t2 - t1);
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[c] + (u3 - u2) * m2;
  };
  const NS = 90, NR = 40;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const w = Math.max(interp(t, 1), 0.001), top = Math.max(interp(t, 2), 0.001), bot = Math.max(interp(t, 3), 0.001), yc = interp(t, 4);
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      // section un peu « carrée » sur les flancs (superellipse)
      const e = 2.3;
      const sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / e), cz = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      pos.push(t - 0.5, yc + (sy > 0 ? top : bot) * sy, w * cz);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * NR + j, b = i * NR + (j + 1) % NR, c = (i + 1) * NR + j, d = (i + 1) * NR + (j + 1) % NR;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  body.add(new THREE.Mesh(geo, material));

  const fin = (shape, depth, matrix) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: 0.008, bevelSegments: 4, curveSegments: 24 });
    g.translate(0, 0, -depth / 2);
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    body.add(new THREE.Mesh(g, material));
  };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v3(1, 1, 1));
  // aileron dorsal falciforme
  const ds = new THREE.Shape();
  ds.moveTo(0.09, 0); ds.bezierCurveTo(0.05, 0.06, -0.03, 0.15, -0.12, 0.2);
  ds.bezierCurveTo(-0.09, 0.13, -0.08, 0.06, -0.11, 0.0); ds.lineTo(0.09, 0);
  fin(ds, 0.016, M(0.06, 0.13, 0));
  // pectorales
  const ps = new THREE.Shape();
  ps.moveTo(0.045, 0); ps.bezierCurveTo(0.02, -0.04, -0.06, -0.09, -0.13, -0.11);
  ps.bezierCurveTo(-0.08, -0.05, -0.05, -0.02, -0.04, 0); ps.lineTo(0.045, 0);
  [-1, 1].forEach((s) => fin(ps, 0.013, M(0.2, -0.075, 0.1 * s, -0.75 * s, 0.35 * s, 0.1)));
  // caudale en croissant
  const fs = new THREE.Shape();
  fs.moveTo(0.03, 0);
  fs.bezierCurveTo(0.01, 0.07, -0.05, 0.16, -0.13, 0.22);
  fs.bezierCurveTo(-0.11, 0.13, -0.08, 0.05, -0.055, 0.012);
  fs.quadraticCurveTo(-0.045, 0, -0.055, -0.012);
  fs.bezierCurveTo(-0.08, -0.05, -0.11, -0.13, -0.13, -0.22);
  fs.bezierCurveTo(-0.05, -0.16, 0.01, -0.07, 0.03, 0);
  fin(fs, 0.014, M(-0.47, 0.0, 0, Math.PI / 2, 0, 0));

  return { root, pitch, body };
}
