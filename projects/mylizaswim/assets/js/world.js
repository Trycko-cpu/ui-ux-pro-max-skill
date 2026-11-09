/* ------------------------------------------------------------------
   MyLizaSwim — le bassin (scène three.js)
   Tout est procédural : aucun modèle 3D externe, aucune texture image
   (hors logo SVG). Unités : mètres. Le bassin va de z = 0 (côté plots)
   à z = -16 (côté tableau d'affichage).
------------------------------------------------------------------- */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';

export const COLORS = {
  blue: '#2F39DA',
  orange: '#D4713D',
  ink: '#0D1240',
  deck: '#F2EEE8',
  deckSide: '#E2DAD0',
  coping: '#FAF8F3',
  white: '#F7F5F0',
  teak: '#B9875A',
  sage: '#8FA98B',
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

  /* ---------- environnement & lumière ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog('#F2EEF4', 34, 78);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(140, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#C9D6FF') },
        mid: { value: new THREE.Color('#F3F1FA') },
        bottom: { value: new THREE.Color('#F1EEF6') },
      },
      vertexShader: /* glsl */`
        varying vec3 vP;
        void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.02, 0.55, h)) : mix(mid, bottom, smoothstep(0.0, 0.35, -h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#EEF3FF', '#ECE6E0', 1.05));
  const sun = new THREE.DirectionalLight('#FFF5EA', 2.6);
  sun.position.set(-10, 17, 7);
  sun.target.position.set(0, 0, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 17, bottom: -17, near: 2, far: 50 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);
  const SUN_DIR = sun.position.clone().sub(sun.target.position).normalize();

  /* ---------- ombre douce sous le diorama ---------- */
  const groundShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 52),
    new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, fog: false,
      map: canvasTexture(256, 256, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(60,52,110,0.30)');
        grd.addColorStop(0.55, 'rgba(60,52,110,0.12)');
        grd.addColorStop(1, 'rgba(60,52,110,0)');
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(POOL.w, POOL.l), std('#ffffff', { map: floorTex, roughness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, POOL.floor, -POOL.l / 2);
  floor.receiveShadow = true;
  pool.add(floor);
  const wallH = -POOL.floor;
  const mkWall = (w, tex, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), std('#ffffff', { map: tex, roughness: 0.35 }));
    m.position.copy(pos); m.rotation.y = rotY; m.receiveShadow = true;
    pool.add(m);
  };
  const inset = 0.004;
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -inset), Math.PI); // côté plots (face vers -z)
  mkWall(POOL.w, endWallTex, v3(0, POOL.floor / 2, -POOL.l + inset), 0);
  mkWall(POOL.l, sideWallTex, v3(-POOL.w / 2 + inset, POOL.floor / 2, -POOL.l / 2), Math.PI / 2);
  mkWall(POOL.l, sideWallTex, v3(POOL.w / 2 - inset, POOL.floor / 2, -POOL.l / 2), -Math.PI / 2);
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
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.42 } },
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
      uShallow: { value: new THREE.Color('#57D3E8') },
      uDeep: { value: new THREE.Color('#2E62E4') },
      uSky: { value: new THREE.Color('#EAF0FF') },
      uSun: { value: SUN_DIR },
      uFill: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; uniform float uFill;
      varying vec3 vW; varying vec2 vUv;
      ${NOISE}
      float height(vec2 p){
        float h = 0.0;
        h += sin(p.x*1.6 + uTime*1.05) * 0.35 + sin(p.y*1.25 - uTime*0.8) * 0.35;
        h += vnoise(p*2.1 + vec2(uTime*0.35, uTime*0.22)) * 1.1;
        h += vnoise(p*5.3 - vec2(uTime*0.55, -uTime*0.4)) * 0.45;
        return h;
      }
      void main(){
        vec2 p = vW.xz;
        float e = 0.04;
        float h = height(p);
        float hx = height(p + vec2(e,0.0));
        float hz = height(p + vec2(0.0,e));
        vec3 n = normalize(vec3(-(hx-h)/e*0.07, 1.0, -(hz-h)/e*0.07));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        // profondeur visuelle : plus profond au centre du bassin
        vec2 edge = min(vUv, 1.0 - vUv);
        float centre = smoothstep(0.0, 0.18, min(edge.x*2.0, edge.y*4.0));
        vec3 col = mix(uShallow, uDeep, 0.25 + 0.3*centre);
        vec3 R = reflect(-V, n);
        float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 2.2;
        float glint = smoothstep(0.82, 1.0, vnoise(p*9.0 + uTime*1.6)) * pow(max(dot(R, uSun), 0.0), 8.0) * 0.8;
        col = mix(col, uSky, clamp(fres*0.85, 0.0, 0.85));
        col += vec3(spec + glint);
        // liseré clair le long des parois
        float rim = 1.0 - smoothstep(0.0, 0.012, min(edge.x*0.5, edge.y*0.25));
        col = mix(col, vec3(0.92,0.98,1.0), rim*0.55);
        float alpha = mix(0.5, 0.92, fres) + spec*0.6 + rim*0.3;
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
      else col.set(Math.floor((-z) / 1.0) % 2 ? COLORS.blue : '#FFFFFF');
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
  [-14.4].forEach((fz) => {
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
    const ped = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.62, 0.5, 4, 0.05), std('#F6F4EE', { roughness: 0.45 }));
    ped.position.y = 0.31;
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.06, 0.68, 3, 0.025), std(COLORS.blue, { roughness: 0.6 }));
    top.position.set(0, 0.67, -0.04);
    top.rotation.x = 0.13;
    const tex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = COLORS.orange; g.beginPath(); g.arc(w / 2, 104, 74, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = `700 104px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(laneNames[i][0], w / 2, 110);
      g.fillStyle = COLORS.ink; g.font = `600 ${laneNames[i][1].length > 10 ? 21 : 27}px ${FONT}`;
      g.fillText(laneNames[i][1], w / 2, 218);
    });
    textures.push(tex);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), std('#ffffff', { map: tex, roughness: 0.5 }));
    plate.position.set(0, 0.33, -0.252);
    plate.rotation.y = Math.PI;
    // poignée de dos
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 8, 24, Math.PI), std('#C9CED6', { metalness: 1, roughness: 0.25 }));
    bar.position.set(0, 0.55, -0.28); bar.rotation.set(0, 0, 0);
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

  /* ---------- 1 · trois bouées (Ma méthode) ---------- */
  const ringGeo = new THREE.TorusGeometry(0.42, 0.155, 28, 72);
  ringGeo.rotateX(Math.PI / 2);
  const ringDefs = [
    { x: -2.5, color: '#E58450', sub: 'sensation' },
    { x: 0, color: '#FFFFFF', sub: 'expression' },
    { x: 2.5, color: '#3843E6', sub: 'application' },
  ];
  ringDefs.forEach((d, i) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(ringGeo, new THREE.MeshPhysicalMaterial({
      color: d.color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'),
    }));
    g.add(m);
    g.position.set(d.x, POOL.water, -7.2 - (i === 1 ? 0.5 : 0));
    shadow(g, true, false);
    g.userData = { station: 'methode', sub: d.sub };
    scene.add(g);
    floaters.push({ obj: g, dy: 0.02, phase: i * 1.7, tilt: 0.06, spin: 0.08 * (i - 1) });
    clickables.push({ root: g, station: 'methode', sub: d.sub });
    anchors[`methode:${d.sub}`] = v3(d.x, 0.75, g.position.z);
  });
  anchors.methode = v3(0, 1.2, -7.7);

  /* ---------- 2 · chaise de maître-nageur + parasol (Votre coach) ---------- */
  const chair = new THREE.Group();
  {
    const white = std('#FBFAF6', { roughness: 0.4 });
    const legGeo = new THREE.CylinderGeometry(0.035, 0.04, 1.62, 10);
    [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]].forEach(([x, z]) => {
      const l = new THREE.Mesh(legGeo, white);
      l.position.set(x * 1.08, 0.81, z * 1.08);
      l.rotation.set(-z * 0.12, 0, x * 0.12);
      chair.add(l);
    });
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 8), white);
      r.rotation.z = Math.PI / 2;
      r.position.set(0, 0.42 + k * 0.38, -0.33 - k * 0.0);
      chair.add(r);
    }
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.07, 0.62, 3, 0.03), white);
    seat.position.y = 1.64;
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.6, 0.06, 3, 0.03), white);
    back.position.set(0, 1.98, 0.3);
    const towelTex = canvasTexture(256, 384, (g, w, h) => {
      g.fillStyle = COLORS.blue; g.fillRect(0, 0, w, h);
      g.fillStyle = COLORS.orange; g.fillRect(0, h - 46, w, 14); g.fillRect(0, 32, w, 14);
      if (logoImg) {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, 170, 70, 0, Math.PI * 2); g.fill();
        g.drawImage(logoImg, w / 2 - 75, 95, 150, 150);
      }
    });
    textures.push(towelTex);
    const towel = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.82, 0.02, 2, 0.008), std('#ffffff', { map: towelTex, roughness: 0.95 }));
    towel.position.set(0, 1.92, 0.26);
    towel.rotation.x = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.6, 8), white);
    pole.position.set(0, 2.45, 0.38);
    const canopyTex = canvasTexture(512, 64, (g, w, h) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : COLORS.orange; g.fillRect((i * w) / 8, 0, w / 8, h); }
    });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.42, 8, 1, true), std('#ffffff', { map: canopyTex, side: THREE.DoubleSide, roughness: 0.85 }));
    canopy.position.set(0, 3.2, 0.38);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), std(COLORS.orange));
    finial.position.set(0, 3.43, 0.38);
    const whistle = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 8), std(COLORS.orange, { roughness: 0.3 }));
    whistle.position.set(0.3, 1.72, -0.1); whistle.rotation.z = Math.PI / 2;
    chair.add(seat, back, towel, pole, canopy, finial, whistle);
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
    const board = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: COLORS.orange, roughness: 0.55, clearcoat: 0.3 }));
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.06), std('#ffffff'));
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

  // frites en mousse posées sur la plage
  [[COLORS.orange, -5.2, -3.0, 0.2], [COLORS.blue, -5.05, -3.35, 0.05], ['#F6D255', -5.35, -3.65, -0.1]].forEach(([c, x, z, r]) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 14), std(c, { roughness: 0.75 }));
    n.rotation.set(0, r, Math.PI / 2); n.rotation.order = 'YXZ';
    n.rotation.set(Math.PI / 2, r + Math.PI / 2, 0);
    n.position.set(x, 0.05, z);
    scene.add(shadow(n));
  });

  /* ---------- 5 · banc + serviettes pliées (Tarifs) ---------- */
  const bench = new THREE.Group();
  {
    const wood = std(COLORS.teak, { roughness: 0.6 });
    for (let k = 0; k < 3; k++) {
      const slat = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.045, 2.0, 2, 0.015), wood);
      slat.position.set(-0.16 + k * 0.16, 0.45, 0);
      bench.add(slat);
    }
    [-0.82, 0.82].forEach((z) => {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.43, 0.06, 2, 0.015), std('#E8E4DC'));
      leg.position.set(0, 0.215, z);
      bench.add(leg);
    });
    const towelColors = [['#FFFFFF'], ['#FFFFFF', COLORS.blue], ['#FFFFFF', COLORS.orange, COLORS.blue]];
    towelColors.forEach((stack, si) => {
      stack.forEach((c, k) => {
        const t = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.075, 0.34, 3, 0.03), std(c, { roughness: 0.95 }));
        t.position.set(0, 0.512 + k * 0.078, -0.58 + si * 0.58);
        t.rotation.y = (k % 2 ? 0.06 : -0.04) + si * 0.03;
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
    const frame = new THREE.Mesh(new RoundedBoxGeometry(6.3, 2.1, 0.18, 3, 0.06), std('#1A1F3D', { roughness: 0.5 }));
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
      g.fillText('★ ★ ★ ★ ★   AVIS', w - 74, 320);
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
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : COLORS.orange; g.fillRect((i * w) / 8, 0, w / 8, h); }
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

  /* ---------- décor : haie derrière les plots ---------- */
  {
    const planter = new THREE.Mesh(new RoundedBoxGeometry(11.5, 0.42, 0.7, 3, 0.06), std('#FAF8F3', { roughness: 0.5 }));
    planter.position.set(0, 0.21, 4.35);
    const hedgeM = std(COLORS.sage, { roughness: 0.95, flatShading: true });
    const hedgeM2 = std('#9DB596', { roughness: 0.95, flatShading: true });
    const hedge = new THREE.Group();
    for (let k = 0; k < 15; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + (k % 3) * 0.05, 1), k % 2 ? hedgeM : hedgeM2);
      b.position.set(-5.3 + k * 0.76, 0.66 + (k % 2) * 0.06, 4.35 + ((k * 7) % 3 - 1) * 0.06);
      b.scale.set(1.05, 0.85, 0.8);
      b.rotation.set(k, k * 1.3, 0);
      hedge.add(b);
    }
    scene.add(shadow(planter), shadow(hedge));
  }

  /* ---------- décor : transats, plantes ---------- */
  const lounger = (x, z, ry) => {
    const g = new THREE.Group();
    const frameM = std('#FBFAF6', { roughness: 0.45 });
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.08, 1.35, 3, 0.03), frameM);
    base.position.set(0, 0.3, 0.2);
    const backM = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.08, 0.7, 3, 0.03), frameM);
    backM.position.set(0, 0.5, -0.72); backM.rotation.x = 0.62;
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.07, 1.28, 3, 0.03), std(COLORS.blue, { roughness: 0.9 }));
    cushion.position.set(0, 0.37, 0.2);
    const cushion2 = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.07, 0.64, 3, 0.03), std(COLORS.blue, { roughness: 0.9 }));
    cushion2.position.set(0, 0.56, -0.68); cushion2.rotation.x = 0.62;
    const towel = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.02, 0.5, 2, 0.008), std(COLORS.orange, { roughness: 0.95 }));
    towel.position.set(0, 0.415, 0.45);
    g.add(base, backM, cushion, cushion2, towel);
    [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.3], [0.28, -0.3]].forEach(([lx, lz]) => {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), frameM);
      l.position.set(lx, 0.14, lz); g.add(l);
    });
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(shadow(g));
  };
  lounger(-6.0, -13.6, Math.PI / 2 - 0.15);
  lounger(-6.0, -15.6, Math.PI / 2 - 0.05);

  const plant = (x, z, s = 1) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.6, 28), std('#F5F1EA', { roughness: 0.6 }));
    pot.position.y = 0.3;
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 20), std('#6B5444'));
    soil.position.y = 0.59;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.1, 8), std('#8A6A50'));
    trunk.position.y = 1.1;
    g.add(pot, soil, trunk);
    const leaf = std(COLORS.sage, { roughness: 0.9, flatShading: true });
    const leaf2 = std('#A9BFA2', { roughness: 0.9, flatShading: true });
    [[0, 1.75, 0, 0.42], [0.25, 1.55, 0.12, 0.3], [-0.24, 1.6, -0.1, 0.32], [0.05, 1.5, -0.26, 0.28], [-0.1, 2.0, 0.1, 0.27]].forEach(([lx, ly, lz, r], k) => {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), k % 2 ? leaf2 : leaf);
      b.position.set(lx, ly, lz); b.rotation.set(k, k * 2, 0);
      g.add(b);
    });
    g.position.set(x, 0, z); g.scale.setScalar(s);
    scene.add(shadow(g));
  };
  plant(-6.6, -20.2, 1.1);
  plant(6.6, -20.2, 1.0);
  plant(7.1, -1.6, 0.85);

  /* ---------- le dauphin en verre ---------- */
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#E9F6FF', metalness: 0, roughness: 0.05,
    transmission: 1, thickness: 0.45, ior: 1.42,
    attenuationColor: new THREE.Color('#5B74FF'), attenuationDistance: 0.9,
    clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: 0.35, iridescenceIOR: 1.25,
    specularIntensity: 1, envMapIntensity: 1.6,
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
    causticMat.uniforms.uStrength.value = 0.42 * THREE.MathUtils.smoothstep(f, 0.1, 0.6);
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
  // yeux
  const eyeM = new THREE.MeshStandardMaterial({ color: '#0D1240', roughness: 0.15 });
  const hiM = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  [-1, 1].forEach((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), eyeM);
    e.position.set(0.335, 0.035, 0.105 * s);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), hiM);
    h.position.set(0.345, 0.045, 0.118 * s);
    body.add(e, h);
  });
  return { root, pitch, body, tail };
}
