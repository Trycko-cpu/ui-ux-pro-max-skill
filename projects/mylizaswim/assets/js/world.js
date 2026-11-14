/* ------------------------------------------------------------------
   MyLizaSwim — le bassin (scène three.js)
   Tout est procédural : aucun modèle 3D externe, aucune texture image
   (hors logo SVG). Unités : mètres. Le bassin va de z = 0 (côté plots)
   à z = -16 (côté tableau d'affichage).
------------------------------------------------------------------- */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';

export const COLORS = {
  blue: '#2F39DA',
  orange: '#D4713D',
  ink: '#0D1240',
  deck: '#EFE7DC',
  deckSide: '#E2DAD0',
  coping: '#FAF8F3',
  white: '#F7F5F0',
  sage: '#4F6A4C',
  navy: '#1C2266',
  teak: '#8F6142',
  cream: '#EEE6D8',
  tile: '#D3F1F5',
  grout: '#B2E3EA',
};

export const POOL = { w: 7.5, l: 16, floor: -1.6, water: -0.14 };
export const LANES = [-2.5, 0, 2.5];
const ROPES = [-1.25, 1.25];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

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

function roundedRect(shape, x0, y0, x1, y1, r) {
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return shape;
}

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
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

const FONT = '"Jost Variable", "Jost", system-ui, sans-serif';

/* ==================================================================
   createWorld
================================================================== */
export function createWorld(renderer, { quality = 'high' } = {}) {
  const scene = new THREE.Scene();
  const low = quality === 'low';
  const textures = []; // textures dépendantes des polices / du logo
  const floaters = []; // objets qui suivent le niveau de l'eau
  const clickables = []; // { root, station, sub }
  const anchors = {}; // ancres des pastilles HTML
  const state = { level: POOL.water, fill: 1, time: 0 };
  let logoImg = null; // rempli de façon asynchrone, les textures se redessinent ensuite

  /* ---------- lumière de fin de journée ---------- */
  scene.add(new THREE.HemisphereLight('#C3C6EE', '#EAD8C8', 0.62));
  const sun = new THREE.DirectionalLight('#FFD6AE', 3.1);
  sun.position.set(16, 8.5, -5);
  sun.target.position.set(0, 0, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 2, far: 70 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 6;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#B4BDFF', 0.4);
  fill.position.set(-12, 7, 10);
  scene.add(fill);
  const SUN_DIR = sun.position.clone().sub(sun.target.position).normalize();

  /* ---------- environnement : un ciel de crépuscule (reflets du verre, de l'inox, de l'eau) ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uSun: { value: SUN_DIR },
        uZenith: { value: new THREE.Color('#1E2486') },
        uHigh: { value: new THREE.Color('#5A4AB0') },
        uHorizon: { value: new THREE.Color('#F09A68') },
        uGround: { value: new THREE.Color('#2A2160') },
      },
      vertexShader: /* glsl */`
        varying vec3 vP;
        void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; uniform vec3 uZenith; uniform vec3 uHigh; uniform vec3 uHorizon; uniform vec3 uGround; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = h > 0.0
            ? mix(mix(uHorizon, uHigh, smoothstep(0.0, 0.32, h)), uZenith, smoothstep(0.3, 0.9, h))
            : mix(uHorizon, uGround, smoothstep(0.0, 0.35, -h));
          float s = max(dot(normalize(vP), uSun), 0.0);
          c += vec3(1.0, 0.72, 0.5) * (pow(s, 48.0) * 6.0 + pow(s, 6.0) * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  ));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.5;
  scene.fog = new THREE.Fog('#8B6C9C', 60, 140);

  /* ---------- fond : dégradé bleu marque → orange marque (fixe à l'écran) ---------- */
  scene.background = canvasTexture(1024, 1024, (g, w, h) => {
    // bleu marque à gauche (sous le titre), soleil couchant orange à droite
    const grd = g.createLinearGradient(0, h * 0.15, w, h * 0.85);
    grd.addColorStop(0, '#121859');
    grd.addColorStop(0.32, '#262C98');
    grd.addColorStop(0.58, '#6B4E9C');
    grd.addColorStop(0.8, '#CF7D5F');
    grd.addColorStop(1, '#F4AE79');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const sunGlow = g.createRadialGradient(w * 0.9, h * 0.5, 0, w * 0.9, h * 0.5, w * 0.6);
    sunGlow.addColorStop(0, 'rgba(255,200,150,0.5)');
    sunGlow.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = sunGlow; g.fillRect(0, 0, w, h);
  });

  /* ---------- ombre douce sous le diorama ---------- */
  const groundShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 52),
    new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, fog: false,
      map: canvasTexture(256, 256, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(10,12,48,0.42)');
        grd.addColorStop(0.55, 'rgba(10,12,48,0.16)');
        grd.addColorStop(1, 'rgba(10,12,48,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      }),
    }),
  );
  groundShadow.rotation.x = -Math.PI / 2;
  groundShadow.position.set(0, -3.2, -8);
  scene.add(groundShadow);

  /* ---------- plage (deck) ---------- */
  const deckTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = COLORS.deck; g.fillRect(0, 0, w, h);
    // légère variation de pierre
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 60},${130 + Math.random() * 40},${100 + Math.random() * 40},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
    g.strokeStyle = 'rgba(160,140,115,0.35)'; g.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke();
    }
  }, { repeat: [1 / 1.6, 1 / 1.6] });

  const deckShape = roundedRect(new THREE.Shape(), -8.2, -5.2, 8.2, 21.4, 1.6);
  const hole = new THREE.Path();
  hole.moveTo(-3.75, 0); hole.lineTo(-3.75, 16); hole.lineTo(3.75, 16); hole.lineTo(3.75, 0); hole.lineTo(-3.75, 0);
  deckShape.holes.push(hole);
  const DECK_T = 1.9;
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: DECK_T, bevelEnabled: false, curveSegments: 28 });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, -DECK_T, 0);
  const deck = new THREE.Mesh(deckGeo, [
    std(COLORS.deck, { map: deckTex, roughness: 0.85 }),
    std(COLORS.deckSide, { roughness: 0.9 }),
  ]);
  deck.receiveShadow = true;
  scene.add(deck);

  // margelle (coping) blanche autour du bassin
  const copShape = roundedRect(new THREE.Shape(), -4.12, -0.38, 4.12, 16.38, 0.22);
  const copHole = new THREE.Path();
  copHole.moveTo(-3.73, 0.02); copHole.lineTo(-3.73, 15.98); copHole.lineTo(3.73, 15.98); copHole.lineTo(3.73, 0.02); copHole.lineTo(-3.73, 0.02);
  copShape.holes.push(copHole);
  const copGeo = new THREE.ExtrudeGeometry(copShape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 12 });
  copGeo.rotateX(-Math.PI / 2);
  copGeo.translate(0, 0.0, 0);
  const coping = new THREE.Mesh(copGeo, std(COLORS.coping, { roughness: 0.55 }));
  coping.receiveShadow = true; coping.castShadow = true;
  scene.add(coping);

  /* ---------- bassin : carrelage, lignes de couloir ---------- */
  const PX = 128; // pixels par mètre
  const tileDraw = (g, w, h, step) => {
    g.fillStyle = COLORS.tile; g.fillRect(0, 0, w, h);
    g.strokeStyle = COLORS.grout; g.lineWidth = 2;
    for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  };
  const floorTex = canvasTexture(POOL.w * PX, POOL.l * PX, (g, w, h) => {
    tileDraw(g, w, h, PX / 4);
    g.fillStyle = COLORS.blue;
    LANES.forEach((lx) => {
      const cx = (lx + POOL.w / 2) * PX;
      g.fillRect(cx - PX * 0.13, 2 * PX, PX * 0.26, (POOL.l - 4) * PX);
      g.fillRect(cx - PX * 0.5, 2 * PX, PX, PX * 0.26);
      g.fillRect(cx - PX * 0.5, (POOL.l - 2) * PX - PX * 0.26, PX, PX * 0.26);
    });
    // logo en mosaïque au fond, couloir central (dessiné quand le logo est prêt)
    if (logoImg) {
      g.globalAlpha = 0.9;
      g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI);
      const s = PX * 1.7;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, s * 0.47, 0, Math.PI * 2); g.fill();
      g.drawImage(logoImg, -s / 2, -s / 2, s, s);
      g.restore(); g.globalAlpha = 1;
    }
  });
  textures.push(floorTex);
  const endWallTex = canvasTexture(POOL.w * PX, 1.6 * PX, (g, w, h) => {
    tileDraw(g, w, h, PX / 4);
    g.fillStyle = COLORS.blue;
    LANES.forEach((lx) => {
      const cx = (lx + POOL.w / 2) * PX;
      g.fillRect(cx - PX * 0.13, PX * 0.3, PX * 0.26, h - PX * 0.3);
      g.fillRect(cx - PX * 0.5, PX * 0.3 + PX * 0.18, PX, PX * 0.26);
    });
  });
  const sideWallTex = canvasTexture(256, 256, (g, w, h) => tileDraw(g, w, h, 64), { repeat: [POOL.l, 1.6] });

  const pool = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(POOL.w, POOL.l), std('#ffffff', { map: floorTex, roughness: 0.4, emissive: '#62B4DA', emissiveMap: floorTex, emissiveIntensity: 0.34 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, POOL.floor, -POOL.l / 2);
  floor.receiveShadow = true;
  pool.add(floor);
  const wallH = -POOL.floor;
  const mkWall = (w, tex, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), std('#ffffff', { map: tex, roughness: 0.35, emissive: '#62B4DA', emissiveMap: tex, emissiveIntensity: 0.3 }));
    m.position.copy(pos); m.rotation.y = rotY; m.receiveShadow = true;
    pool.add(m);
  };
  const inset = 0.004;
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -inset), Math.PI); // côté plots (face vers -z)
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -POOL.l + inset), 0);
  mkWall(POOL.l, sideWallTex, v3(-POOL.w / 2 + inset, POOL.floor / 2, -POOL.l / 2), Math.PI / 2);
  mkWall(POOL.l, sideWallTex, v3(POOL.w / 2 - inset, POOL.floor / 2, -POOL.l / 2), -Math.PI / 2);
  // projecteurs immergés et liseré lumineux sous la margelle
  {
    const lampM = new THREE.MeshBasicMaterial({ color: '#E9FBFF' });
    const lampGeo = new THREE.CircleGeometry(0.11, 24);
    for (let z = -2; z >= -14; z -= 4) {
      [-1, 1].forEach((side) => {
        const l = new THREE.Mesh(lampGeo, lampM);
        l.position.set(side * (POOL.w / 2 - 0.01), -0.62, z);
        l.rotation.y = -side * Math.PI / 2;
        pool.add(l);
      });
    }
    const stripM = new THREE.MeshBasicMaterial({ color: '#CFF3FF', transparent: true, opacity: 0.75 });
    [[POOL.w, 0, -0.012], [POOL.w, 0, -POOL.l + 0.012]].forEach(([w, x, z]) => {
      const st = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.01), stripM);
      st.position.set(x, -0.07, z); pool.add(st);
    });
    [-1, 1].forEach((side) => {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.018, POOL.l), stripM);
      st.position.set(side * (POOL.w / 2 - 0.012), -0.07, -POOL.l / 2); pool.add(st);
    });
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
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.5 } },
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
        vec3 col = vec3(0.92, 1.0, 1.0) * c * uStrength;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(POOL.w, POOL.l), causticMat);
  caustics.rotation.x = -Math.PI / 2;
  caustics.position.set(0, POOL.floor + 0.006, -POOL.l / 2);
  caustics.renderOrder = 1;
  scene.add(caustics);

  /* ---------- l'eau ---------- */
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#46C2E2') },
      uDeep: { value: new THREE.Color('#1D49C4') },
      uZenith: { value: new THREE.Color('#3438A8') },
      uHorizon: { value: new THREE.Color('#F2A272') },
      uSunCol: { value: new THREE.Color('#FFC596') },
      uSun: { value: SUN_DIR },
      uFill: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunCol; uniform vec3 uSun; uniform float uFill;
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
        float hx = height(p + vec2(e,0.0));
        float hz = height(p + vec2(0.0,e));
        vec3 n = normalize(vec3(-(hx-h)/e*0.06, 1.0, -(hz-h)/e*0.06));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec2 edge = min(vUv, 1.0 - vUv);
        float centre = smoothstep(0.0, 0.18, min(edge.x*2.0, edge.y*4.0));
        vec3 col = mix(uShallow, uDeep, 0.3 + 0.35*centre);
        vec3 R = reflect(-V, n);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.02, 0.55, R.y));
        float s = max(dot(R, uSun), 0.0);
        float spec = pow(s, 260.0) * 2.4 + pow(s, 24.0) * 0.18;
        float glint = smoothstep(0.84, 1.0, vnoise(p*9.0 + uTime*1.4)) * pow(s, 6.0) * 0.9;
        col = mix(col, sky, clamp(fres*0.9, 0.0, 0.9));
        col += uSunCol * (spec + glint);
        float rim = 1.0 - smoothstep(0.0, 0.012, min(edge.x*0.5, edge.y*0.25));
        col = mix(col, vec3(0.86,0.97,1.0), rim*0.45);
        float alpha = mix(0.55, 0.94, fres) + spec*0.5 + rim*0.3;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFill);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(POOL.w - 0.01, POOL.l - 0.01), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, POOL.water, -POOL.l / 2);
  water.renderOrder = 5;
  scene.add(water);

  /* ---------- lignes d'eau (flotteurs) ---------- */
  const floatProfile = [
    [0.0, -0.045], [0.03, -0.045], [0.052, -0.025], [0.058, 0], [0.052, 0.025], [0.03, 0.045], [0.0, 0.045],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const floatGeo = new THREE.LatheGeometry(floatProfile, 14);
  floatGeo.rotateX(Math.PI / 2);
  const SPACING = 0.115;
  const nFloats = Math.floor((POOL.l - 0.3) / SPACING);
  const ropes = ROPES.map((rx, ri) => {
    const mesh = new THREE.InstancedMesh(floatGeo, std('#ffffff', { roughness: 0.32 }), nFloats);
    const col = new THREE.Color();
    for (let i = 0; i < nFloats; i++) {
      const z = -0.15 - i * SPACING;
      const fromEnd = Math.min(-z, POOL.l + z);
      if (fromEnd < 2.2) col.set(COLORS.orange);
      else col.set(Math.floor((-z) / 1.0) % 2 ? COLORS.navy : '#F4F1EA');
      mesh.setColorAt(i, col);
    }
    mesh.userData = { x: rx, ri };
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });
  const dummy = new THREE.Object3D();
  function updateRopes(t) {
    ropes.forEach((mesh) => {
      const { x, ri } = mesh.userData;
      for (let i = 0; i < nFloats; i++) {
        const z = -0.15 - i * SPACING;
        dummy.position.set(x + Math.sin(t * 0.9 + z * 0.6 + ri) * 0.012, state.level + 0.012 + Math.sin(t * 1.6 + z * 0.9 + ri * 2) * 0.012, z);
        dummy.rotation.set(0, 0, Math.sin(t * 1.3 + z * 1.7) * 0.3);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /* ---------- fanions de dos ---------- */
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.075, 0, 0, 0.075, 0, 0, 0, -0.18, 0], 3));
  flagGeo.computeVertexNormals();
  const flagLines = [];
  [].forEach((fz) => { // fanions retirés (rendu plus sobre)
    const posts = [-4.75, 4.75].map((px) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.0, 12), std('#F4F2EC', { roughness: 0.4, metalness: 0.1 }));
      p.position.set(px, 1.0, fz);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.06, 20), std('#D9D6CF'));
      foot.position.set(px, 0.03, fz);
      scene.add(shadow(p), shadow(foot));
      return p;
    });
    const curve = new THREE.QuadraticBezierCurve3(v3(-4.75, 1.95, fz), v3(0, 1.62, fz), v3(4.75, 1.95, fz));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.007, 6), std('#ffffff')));
    const count = 36;
    const mesh = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), count);
    const col = new THREE.Color();
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = 0.04 + (i / (count - 1)) * 0.92;
      pts.push(curve.getPoint(t));
      col.set([COLORS.orange, '#FFFFFF', COLORS.blue][i % 3]);
      mesh.setColorAt(i, col);
    }
    mesh.castShadow = true;
    mesh.userData.pts = pts;
    scene.add(mesh);
    flagLines.push(mesh);
    void posts;
  });
  function updateFlags(t) {
    flagLines.forEach((mesh, li) => {
      mesh.userData.pts.forEach((p, i) => {
        dummy.position.copy(p);
        dummy.rotation.set(Math.sin(t * 2.4 + i * 0.7 + li) * 0.28 + 0.15, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /* ---------- 3 · plots de départ (Quel nageur êtes-vous ?) ---------- */
  const laneNames = [['1', 'AQUABABY'], ['2', 'ENFANTS'], ['3', 'JEUNES · ADULTES']];
  const blocksRoot = new THREE.Group();
  [...LANES].reverse().forEach((lx, i) => {
    const b = new THREE.Group();
    const ped = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.62, 0.5, 4, 0.04), std('#F5F3EF', { roughness: 0.3 }));
    ped.position.y = 0.31;
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.05, 0.66, 3, 0.02), std(COLORS.teak, { roughness: 0.6 }));
    top.position.set(0, 0.665, -0.04);
    top.rotation.x = 0.12;
    const tex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#F5F3EF'; g.fillRect(0, 0, w, h);
      g.fillStyle = COLORS.navy; g.font = `300 132px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(laneNames[i][0], w / 2, 104);
      g.fillStyle = COLORS.orange; g.fillRect(w / 2 - 18, 178, 36, 3);
      g.fillStyle = COLORS.navy; g.font = `600 ${laneNames[i][1].length > 10 ? 17 : 21}px ${FONT}`;
      if ('letterSpacing' in g) g.letterSpacing = '4px';
      g.fillText(laneNames[i][1], w / 2, 214);
    });
    textures.push(tex);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), std('#ffffff', { map: tex, roughness: 0.4 }));
    plate.position.set(0, 0.33, -0.252);
    plate.rotation.y = Math.PI;
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.013, 8, 24, Math.PI), std('#D5DAE2', { metalness: 1, roughness: 0.18 }));
    bar.position.set(0, 0.55, -0.28);
    b.add(ped, top, plate, bar);
    b.position.set(lx, 0, 0.6);
    shadow(b);
    b.userData = { station: 'nageurs', sub: ['aquababy', 'enfants', 'adultes'][i] };
    blocksRoot.add(b);
    clickables.push({ root: b, station: 'nageurs', sub: b.userData.sub });
    anchors[`nageurs:${b.userData.sub}`] = v3(lx, 1.05, 0.6);
  });
  scene.add(blocksRoot);
  anchors.nageurs = v3(0, 1.35, 0.6);

  /* ---------- 1 · trois lumières flottantes (Ma méthode) ---------- */
  const glowTex = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const orbGeo = new THREE.SphereGeometry(0.24, 48, 32);
  const poolGlowGeo = new THREE.CircleGeometry(1.15, 48);
  poolGlowGeo.rotateX(-Math.PI / 2);
  const orbDefs = [
    { x: -2.5, color: '#FF9550', sub: 'sensation' },
    { x: 0, color: '#FFD9A0', sub: 'expression' },
    { x: 2.5, color: '#7C88FF', sub: 'application' },
  ];
  orbDefs.forEach((d, i) => {
    const g = new THREE.Group();
    const orb = new THREE.Mesh(orbGeo, new THREE.MeshPhysicalMaterial({
      color: d.color, emissive: d.color, emissiveIntensity: 0.85, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15,
    }));
    orb.position.y = 0.1;
    orb.castShadow = false;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: d.color, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(2.4, 2.4, 1);
    halo.position.y = 0.1;
    halo.renderOrder = 8;
    const pool2 = new THREE.Mesh(poolGlowGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: d.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool2.position.y = 0.012;
    pool2.renderOrder = 7;
    const lamp = new THREE.PointLight(d.color, 3.2, 5, 1.5);
    lamp.position.y = 0.35;
    g.add(orb, halo, pool2, lamp);
    g.position.set(d.x, POOL.water, -7.2 - (i === 1 ? 0.5 : 0));
    g.userData = { station: 'methode', sub: d.sub };
    scene.add(g);
    floaters.push({ obj: g, dy: 0, phase: i * 1.7, tilt: 0.02, spin: 0 });
    clickables.push({ root: g, station: 'methode', sub: d.sub });
    anchors[`methode:${d.sub}`] = v3(d.x, 0.85, g.position.z);
  });
  anchors.methode = v3(0, 1.25, -7.7);

  /* ---------- 2 · chaise de maître-nageur + parasol (Votre coach) ---------- */
  const chair = new THREE.Group();
  {
    const white = std('#F7F5F0', { roughness: 0.35 });
    const teak = std(COLORS.teak, { roughness: 0.55 });
    const legGeo = new THREE.CylinderGeometry(0.03, 0.036, 1.62, 12);
    [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]].forEach(([x, z]) => {
      const l = new THREE.Mesh(legGeo, white);
      l.position.set(x * 1.08, 0.81, z * 1.08);
      l.rotation.set(-z * 0.12, 0, x * 0.12);
      chair.add(l);
    });
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.035, 0.09, 2, 0.012), teak);
      r.position.set(0, 0.42 + k * 0.38, -0.33);
      chair.add(r);
    }
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.06, 0.6, 3, 0.025), teak);
    seat.position.y = 1.64;
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.56, 0.05, 3, 0.022), teak);
    back.position.set(0, 1.97, 0.3);
    const towelTex = canvasTexture(256, 384, (g, w, h) => {
      g.fillStyle = COLORS.navy; g.fillRect(0, 0, w, h);
      g.fillStyle = COLORS.orange; g.fillRect(0, h - 40, w, 4);
      if (logoImg) {
        g.globalAlpha = 0.95;
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, 170, 54, 0, Math.PI * 2); g.fill();
        g.drawImage(logoImg, w / 2 - 58, 112, 116, 116);
        g.globalAlpha = 1;
      }
    });
    textures.push(towelTex);
    const towel = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.8, 0.02, 2, 0.008), std('#ffffff', { map: towelTex, roughness: 0.95 }));
    towel.position.set(0, 1.9, 0.27);
    towel.rotation.x = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 10), std('#D5DAE2', { metalness: 1, roughness: 0.2 }));
    pole.position.set(0, 2.45, 0.38);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.34, 4, 1, true), std('#EFE6D6', { side: THREE.DoubleSide, roughness: 0.9 }));
    canopy.position.set(0, 3.18, 0.38);
    canopy.rotation.y = Math.PI / 4;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), std(COLORS.navy));
    finial.position.set(0, 3.37, 0.38);
    chair.add(seat, back, towel, pole, canopy, finial);
  }
  chair.position.set(5.7, 0, -7.6);
  chair.rotation.y = Math.PI / 2 + 0.25;
  shadow(chair);
  chair.userData = { station: 'coach' };
  scene.add(chair);
  clickables.push({ root: chair, station: 'coach' });
  anchors.coach = v3(5.7, 2.75, -7.6);

  /* ---------- 4 · échelle + planche (Le premier cours) ---------- */
  const ladder = new THREE.Group();
  {
    const steel = std('#D7DCE3', { metalness: 1, roughness: 0.18 });
    [-0.3, 0.3].forEach((dz) => {
      const c = new THREE.CatmullRomCurve3([
        v3(-0.45, 0.0, dz), v3(-0.45, 0.62, dz), v3(-0.32, 0.85, dz), v3(-0.08, 0.82, dz), v3(0.06, 0.5, dz), v3(0.1, 0.0, dz), v3(0.1, -1.25, dz),
      ]);
      ladder.add(new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.024, 10), steel));
    });
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.035, 0.6, 2, 0.012), steel);
      s.position.set(0.13, -0.32 - k * 0.3, 0);
      ladder.add(s);
    }
  }
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
    const board = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: COLORS.navy, roughness: 0.6, clearcoat: 0.25 }));
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.02), std(COLORS.orange));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.06, 0.05);
    kick.add(board, stripe);
  }
  kick.position.set(-2.55, POOL.water, -4.3);
  kick.rotation.y = 0.5;
  shadow(kick, true, false);
  kick.userData = { station: 'premier-cours' };
  scene.add(kick);
  floaters.push({ obj: kick, dy: 0.0, phase: 0.4, tilt: 0.05, spin: 0.05 });
  clickables.push({ root: kick, station: 'premier-cours' });
  anchors['premier-cours'] = v3(-3.6, 1.15, -3.4);

  // serviette pliée au bord de l'échelle
  {
    const t = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.06, 0.34, 3, 0.025), std(COLORS.cream, { roughness: 0.95 }));
    t.position.set(-4.6, 0.03, -4.25); t.rotation.y = 0.2;
    scene.add(shadow(t));
  }

  /* ---------- 5 · banc + serviettes pliées (Tarifs) ---------- */
  const bench = new THREE.Group();
  {
    const wood = std(COLORS.teak, { roughness: 0.55 });
    for (let k = 0; k < 3; k++) {
      const slat = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.045, 2.0, 2, 0.015), wood);
      slat.position.set(-0.16 + k * 0.16, 0.45, 0);
      bench.add(slat);
    }
    [-0.82, 0.82].forEach((z) => {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.43, 0.07, 2, 0.015), std('#D8D1C6', { roughness: 0.85 }));
      leg.position.set(0, 0.215, z);
      bench.add(leg);
    });
    const towelColors = [['#F6F3EC'], ['#F6F3EC', COLORS.navy], ['#F6F3EC', COLORS.cream, COLORS.navy]];
    towelColors.forEach((stack, si) => {
      stack.forEach((c, k) => {
        const t = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.072, 0.34, 3, 0.03), std(c, { roughness: 0.95 }));
        t.position.set(0, 0.51 + k * 0.075, -0.58 + si * 0.58);
        t.rotation.y = (k % 2 ? 0.04 : -0.03);
        bench.add(t);
      });
    });
  }
  bench.position.set(5.85, 0, -12.2);
  shadow(bench);
  bench.userData = { station: 'tarifs' };
  scene.add(bench);
  clickables.push({ root: bench, station: 'tarifs' });
  anchors.tarifs = v3(5.85, 1.25, -12.2);

  /* ---------- 6 · tableau d'affichage (Avis) ---------- */
  const board = new THREE.Group();
  let boardTex;
  {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(6.3, 2.1, 0.18, 3, 0.06), std('#12162E', { roughness: 0.45, metalness: 0.3 }));
    frame.position.y = 2.15;
    boardTex = canvasTexture(1536, 480, (g, w, h) => {
      g.fillStyle = '#0B1047'; g.fillRect(0, 0, w, h);
      // trame LED
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
      const rows = [['1', 'AQUABABY', '3 MOIS – 1 AN'], ['2', 'ENFANTS', '1 – 9 ANS'], ['3', 'JEUNES & ADULTES', '9 ANS ET +']];
      rows.forEach((r, i) => {
        const y = 230 + i * 74;
        g.fillStyle = COLORS.orange; g.font = `700 44px ${FONT}`; g.fillText(r[0], 304, y);
        g.fillStyle = '#ffffff'; g.font = `600 40px ${FONT}`; g.fillText(r[1], 360, y);
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `500 32px ${FONT}`; g.fillText(r[2], 820, y);
      });
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      g.textAlign = 'right';
      g.fillStyle = '#FF9A5C'; g.font = `600 128px ${FONT}`;
      g.fillText(`${hh}:${mm}`, w - 70, 200);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `500 30px ${FONT}`;
      g.fillText('A V I S', w - 74, 320);
      g.textAlign = 'left';
    });
    textures.push(boardTex);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 1.875), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
    face.position.set(0, 2.15, 0.095);
    const legGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.2, 12);
    [-2.4, 2.4].forEach((x) => {
      const l = new THREE.Mesh(legGeo, std('#2A2F4F'));
      l.position.set(x, 0.6, -0.02);
      board.add(l);
    });
    board.add(frame, face);
  }
  board.position.set(0, 0, -19.4);
  shadow(board);
  board.userData = { station: 'avis' };
  scene.add(board);
  clickables.push({ root: board, station: 'avis' });
  anchors.avis = v3(0, 3.4, -19.4);

  /* ---------- 7 · bouée de sauvetage (FAQ) ---------- */
  const buoyStand = new THREE.Group();
  {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.75, 12), std('#FBFAF6', { roughness: 0.4 }));
    post.position.y = 0.875;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.08, 24), std('#DCD8D0'));
    base.position.y = 0.04;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI), std('#C9CED6', { metalness: 1, roughness: 0.3 }));
    hook.position.set(0, 1.62, 0.06);
    const stripes = canvasTexture(512, 64, (g, w, h) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#F6F3EC' : COLORS.navy; g.fillRect((i * w) / 8, 0, w / 8, h); }
    });
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 24, 64), new THREE.MeshPhysicalMaterial({ map: stripes, roughness: 0.4, clearcoat: 0.6 }));
    buoy.position.set(0, 1.22, 0.14);
    buoy.name = 'buoy';
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.012, 6, 64), std('#F2EEE6'));
    rope.position.copy(buoy.position); rope.scale.setScalar(1.0);
    buoyStand.add(post, base, hook, buoy, rope);
  }
  buoyStand.position.set(6.3, 0, -16.9);
  buoyStand.rotation.y = -0.75;
  shadow(buoyStand);
  buoyStand.userData = { station: 'faq' };
  scene.add(buoyStand);
  clickables.push({ root: buoyStand, station: 'faq' });
  anchors.faq = v3(6.3, 2.25, -16.9);

  /* ---------- décor : feuillage (texture commune) ---------- */
  const leafTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#5E7F58'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5 ? `rgba(120,150,110,${0.25 + Math.random() * 0.3})` : `rgba(30,50,32,${0.25 + Math.random() * 0.3})`;
      const r = 1 + Math.random() * 3.5;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); g.fill();
    }
  }, { repeat: [3, 2] });
  const leafM = std('#ffffff', { map: leafTex, roughness: 0.95 });
  const concrete = std('#D3CBBF', { roughness: 0.9 });

  /* ---------- décor : haie taillée derrière les plots ---------- */
  {
    const planter = new THREE.Mesh(new RoundedBoxGeometry(11.6, 0.42, 0.72, 3, 0.04), concrete);
    planter.position.set(0, 0.21, 4.35);
    const hedgeTex = leafTex.clone(); hedgeTex.repeat.set(14, 1); hedgeTex.needsUpdate = true;
    const hedge = new THREE.Mesh(new RoundedBoxGeometry(11.3, 0.62, 0.56, 4, 0.2), std('#ffffff', { map: hedgeTex, roughness: 0.95 }));
    hedge.position.set(0, 0.72, 4.35);
    scene.add(shadow(planter), shadow(hedge));
  }

  /* ---------- décor : transats, topiaires ---------- */
  const lounger = (x, z, ry) => {
    const g = new THREE.Group();
    const wood = std(COLORS.teak, { roughness: 0.55 });
    const cushionM = std(COLORS.cream, { roughness: 0.95 });
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.07, 1.35, 3, 0.025), wood);
    base.position.set(0, 0.3, 0.2);
    const backM = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.07, 0.7, 3, 0.025), wood);
    backM.position.set(0, 0.5, -0.72); backM.rotation.x = 0.62;
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.08, 1.3, 3, 0.035), cushionM);
    cushion.position.set(0, 0.37, 0.2);
    const cushion2 = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.08, 0.66, 3, 0.035), cushionM);
    cushion2.position.set(0, 0.56, -0.68); cushion2.rotation.x = 0.62;
    const towel = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.05, 0.3, 2, 0.02), std(COLORS.navy, { roughness: 0.95 }));
    towel.position.set(0, 0.435, 0.55);
    g.add(base, backM, cushion, cushion2, towel);
    [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.3], [0.28, -0.3]].forEach(([lx, lz]) => {
      const l = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.28, 0.05, 1, 0.01), wood);
      l.position.set(lx, 0.14, lz); g.add(l);
    });
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(shadow(g));
  };
  lounger(-6.0, -13.6, Math.PI / 2 - 0.15);
  lounger(-6.0, -15.6, Math.PI / 2 - 0.05);

  const plant = (x, z, s = 1) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.66, 0.62, 3, 0.04), concrete);
    pot.position.y = 0.33;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.9, 8), std('#6B523E'));
    stem.position.y = 1.05;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 32), leafM);
    ball.position.y = 1.72;
    g.add(pot, stem, ball);
    g.position.set(x, 0, z); g.scale.setScalar(s);
    scene.add(shadow(g));
  };
  plant(-6.6, -20.2, 1.1);
  plant(6.6, -20.2, 1.0);
  plant(7.1, -1.6, 0.9);

  /* ---------- le dauphin en cristal ---------- */
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF', metalness: 0, roughness: 0.03,
    transmission: 1, thickness: 0.6, ior: 1.5, dispersion: 2.5,
    attenuationColor: new THREE.Color('#A9B4FF'), attenuationDistance: 1.6,
    clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 0.5, iridescenceIOR: 1.3,
    specularIntensity: 1, envMapIntensity: 1.8,
  });
  const dolphin = buildDolphin(glass);
  dolphin.root.scale.setScalar(1.4);
  scene.add(dolphin.root);
  shadow(dolphin.root, true, false);

  /* ---------- éclaboussures & ondes ---------- */
  const ripples = [];
  const rippleGeo = new THREE.RingGeometry(0.86, 1.0, 64);
  rippleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
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
  const dropTex = canvasTexture(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(235,248,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  });
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ size: 0.09, map: dropTex, transparent: true, depthWrite: false, color: '#ffffff' }));
  drops.frustumCulled = false; drops.renderOrder = 7;
  scene.add(drops);
  let dropCursor = 0;
  function splash(x, z, n = 40, power = 1) {
    for (let k = 0; k < n; k++) {
      const i = dropCursor; dropCursor = (dropCursor + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.4) * power;
      dropPos.set([x + Math.cos(a) * 0.15, state.level + 0.03, z + Math.sin(a) * 0.15], i * 3);
      dropVel.set([Math.cos(a) * sp, (2.0 + Math.random() * 2.4) * power, Math.sin(a) * sp], i * 3);
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
      r.m.material.opacity = (1 - k) * 0.55;
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

  /* ---------- logo (chargé en asynchrone) ---------- */
  const ready = Promise.all([
    loadImage('assets/img/logo-mark.svg').then((img) => { logoImg = img; }),
    document.fonts ? document.fonts.ready : Promise.resolve(),
  ]).then(() => textures.forEach((t) => t.userData.redraw()));

  // horloge du tableau : rafraîchie chaque minute
  const clockTimer = setInterval(() => boardTex.userData.redraw(), 30000);

  /* ---------- niveau de l'eau (intro : remplissage) ---------- */
  function setFill(f) {
    state.fill = f;
    state.level = THREE.MathUtils.lerp(POOL.floor + 0.02, POOL.water, f);
    water.position.y = state.level;
    waterMat.uniforms.uFill.value = THREE.MathUtils.smoothstep(f, 0, 0.12);
    causticMat.uniforms.uStrength.value = 0.5 * THREE.MathUtils.smoothstep(f, 0.1, 0.6);
    ropes.forEach((r) => { r.visible = f > 0.02; });
  }

  /* ---------- boucle ---------- */
  function update(t, dt) {
    state.time = t;
    waterMat.uniforms.uTime.value = t;
    causticMat.uniforms.uTime.value = t;
    updateRopes(t);
    updateFlags(t);
    floaters.forEach((f) => {
      const o = f.obj;
      o.position.y = state.level + f.dy + Math.sin(t * 1.4 + f.phase) * 0.025;
      o.rotation.x = Math.sin(t * 1.1 + f.phase) * f.tilt;
      o.rotation.z = Math.cos(t * 0.9 + f.phase) * f.tilt;
      if (o.userData.station === 'methode') o.rotation.y += f.spin * dt;
    });
    const b = buoyStand.getObjectByName('buoy');
    if (b) b.rotation.z = Math.sin(t * 0.8) * 0.04;
    updateFx(dt);
  }

  return {
    scene, update, ready, clickables, anchors, dolphin, splash, ripple, setFill, state, POOL,
    stop: () => clearInterval(clockTimer),
  };
}

/* ==================================================================
   Dauphin procédural (verre)
================================================================== */
function buildDolphin(material) {
  const root = new THREE.Group(); // position / lacet
  const pitch = new THREE.Group(); // tangage
  root.add(pitch);
  const body = new THREE.Group();
  pitch.add(body);

  // profil (rayon, position le long du corps) — queue en 0, rostre en 1
  const prof = [
    [0.001, 0], [0.026, 0.02], [0.04, 0.1], [0.07, 0.24], [0.112, 0.39], [0.148, 0.52], [0.16, 0.6],
    [0.156, 0.68], [0.142, 0.76], [0.112, 0.835], [0.07, 0.875], [0.052, 0.91], [0.04, 0.95], [0.026, 0.985], [0.001, 1.0],
  ].map(([r, y]) => new THREE.Vector2(r, y - 0.5));
  const geo = new THREE.LatheGeometry(prof, 40);
  geo.rotateZ(-Math.PI / 2); // axe du corps → +x (tête vers +x)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    z *= 0.86; // corps légèrement aplati
    if (y < 0) y *= 0.9; // ventre plus plat
    y += -0.16 * x * x + 0.02; // dos cambré
    if (x > 0.36) y -= (x - 0.36) * 0.18; // rostre un peu plus bas
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  body.add(new THREE.Mesh(geo, material));

  const fin = (shape, depth) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: 0.012, bevelSegments: 3, curveSegments: 14 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  // aileron dorsal
  const ds = new THREE.Shape();
  ds.moveTo(0.1, 0); ds.quadraticCurveTo(0.02, 0.07, -0.1, 0.19); ds.quadraticCurveTo(-0.07, 0.08, -0.12, 0); ds.lineTo(0.1, 0);
  const dorsal = new THREE.Mesh(fin(ds, 0.018), material);
  dorsal.position.set(0.02, 0.14, 0);
  body.add(dorsal);
  // nageoires pectorales
  const ps = new THREE.Shape();
  ps.moveTo(0.05, 0); ps.quadraticCurveTo(0.0, -0.05, -0.12, -0.11); ps.quadraticCurveTo(-0.05, -0.03, -0.05, 0); ps.lineTo(0.05, 0);
  [-1, 1].forEach((s) => {
    const p = new THREE.Mesh(fin(ps, 0.014), material);
    p.position.set(0.2, -0.08, 0.1 * s);
    p.rotation.set(-0.7 * s, 0.35 * s, 0);
    body.add(p);
  });
  // caudale
  const tail = new THREE.Group();
  const fs = new THREE.Shape();
  fs.moveTo(0.03, 0);
  fs.quadraticCurveTo(-0.02, 0.1, -0.15, 0.2);
  fs.quadraticCurveTo(-0.11, 0.09, -0.07, 0.02);
  fs.quadraticCurveTo(-0.05, 0, -0.07, -0.02);
  fs.quadraticCurveTo(-0.11, -0.09, -0.15, -0.2);
  fs.quadraticCurveTo(-0.02, -0.1, 0.03, 0);
  const flukes = new THREE.Mesh(fin(fs, 0.016), material);
  flukes.rotation.x = Math.PI / 2;
  tail.add(flukes);
  tail.position.set(-0.49, -0.02, 0);
  body.add(tail);
  return { root, pitch, body, tail };
}
