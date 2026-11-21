/* Exporte la scène three.js vers Blender pour la cuisson de la lumière.
   Usage : node blender/export-scene.cjs <url du site> <dossier de sortie>
   (le site doit être servi, ex. python3 -m http.server 8765 dans projects/mylizaswim)
   Sortie : scene.json (objets, matériaux, lumières) + scene.bin (géométries en coordonnées monde). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [url = 'http://localhost:8765/', out = 'bake-src'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${url}?classique`, { waitUntil: 'load' });
  const data = await page.evaluate(async () => {
    const THREE = await import('three');
    const W = await import('./assets/js/world.js');
    const renderer = new THREE.WebGLRenderer();
    const world = W.createWorld(renderer, { quality: 'high' });
    world.stop();
    const scene = world.scene;
    scene.updateMatrixWorld(true);

    const lin = (c) => [c.r, c.g, c.b];
    const avgCache = new Map();
    const srgbToLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    function texAvg(tex) {
      if (!tex || !tex.image) return [1, 1, 1];
      if (avgCache.has(tex)) return avgCache.get(tex);
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const g = cv.getContext('2d');
      g.drawImage(tex.image, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      const acc = [0, 0, 0]; let wsum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255; wsum += a;
        for (let c = 0; c < 3; c++) acc[c] += srgbToLin(d[i + c] / 255) * a;
      }
      const r = acc.map((v) => (wsum ? v / wsum : 1));
      avgCache.set(tex, r);
      return r;
    }
    const mul = (a, b) => a.map((v, i) => v * b[i]);
    function matInfo(m) {
      if (m.isMeshBasicMaterial) return { basic: true, color: mul(lin(m.color), texAvg(m.map)) };
      return {
        color: mul(lin(m.color), texAvg(m.map)),
        rough: m.roughness, metal: m.metalness,
        emit: mul(lin(m.emissive), m.emissiveMap ? texAvg(m.emissiveMap) : [1, 1, 1]).map((v) => v * m.emissiveIntensity),
      };
    }

    const chunks = []; let offset = 0;
    const push = (typed) => {
      const b = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      chunks.push(btoa(s));
      const o = offset; offset += b.length;
      while (offset % 4) { chunks.push(btoa('\0')); offset++; }
      return o;
    };

    const meshes = [];
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    W.bakeTargets(scene).forEach(({ obj, key, kind }) => {
      const g = obj.geometry, pos = g.attributes.position, nrm = g.attributes.normal;
      const n = pos.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
      nm.getNormalMatrix(obj.matrixWorld);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld); P.set([v.x, v.y, v.z], i * 3);
        if (nrm) { v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); N.set([v.x, v.y, v.z], i * 3); }
      }
      let I;
      if (g.index) I = Uint32Array.from(g.index.array);
      else { I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; }
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]).map(matInfo);
      // groupe de chaque triangle (matériaux multiples)
      const tri = new Uint8Array(I.length / 3);
      g.groups.forEach((gr) => { for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) tri[t] = gr.materialIndex; });
      const side = (Array.isArray(obj.material) ? obj.material[0] : obj.material).side;
      meshes.push({ key, kind, nv: n, ni: I.length, pos: push(P), nrm: push(N), idx: push(I), tri: push(tri), mats, double: side === THREE.DoubleSide });
    });

    const lights = [];
    const wp = new THREE.Vector3(), tp = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isLight) return;
      o.getWorldPosition(wp);
      const base = { color: lin(o.color), intensity: o.intensity, pos: [wp.x, wp.y, wp.z] };
      if (o.isDirectionalLight || o.isSpotLight) { o.target.getWorldPosition(tp); base.target = [tp.x, tp.y, tp.z]; }
      if (o.isDirectionalLight) lights.push({ type: 'sun', ...base });
      else if (o.isSpotLight) lights.push({ type: 'spot', ...base, angle: o.angle, penumbra: o.penumbra, decay: o.decay });
      else if (o.isPointLight) lights.push({ type: 'point', ...base, decay: o.decay });
      else if (o.isHemisphereLight) lights.push({ type: 'hemi', sky: lin(o.color), ground: lin(o.groundColor), intensity: o.intensity });
    });
    const fakes = [];
    scene.traverse((o) => {
      if (!o.userData.fake || !o.geometry || !o.geometry.parameters) return;
      const f = o.userData.fake;
      fakes.push({ ...f, color: f.color ? lin(new THREE.Color(f.color)) : null, w: o.geometry.parameters.width, h: o.geometry.parameters.height, m: o.matrixWorld.elements.slice() });
    });
    const bulbs = [];
    const im = new THREE.Matrix4();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.material.isMeshBasicMaterial) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im); im.premultiply(o.matrixWorld);
        wp.setFromMatrixPosition(im);
        bulbs.push({ pos: [wp.x, wp.y, wp.z], color: lin(o.material.color) });
      }
    });
    return { meshes, lights, fakes, bulbs, env: scene.environmentIntensity, bin: chunks };
  });
  const bin = Buffer.concat(data.bin.map((b) => Buffer.from(b, 'base64')));
  delete data.bin;
  fs.writeFileSync(path.join(out, 'scene.bin'), bin);
  fs.writeFileSync(path.join(out, 'scene.json'), JSON.stringify(data));
  const lit = data.meshes.filter((m) => m.kind === 'lit');
  console.log(`export : ${lit.length} surfaces éclairées, ${data.meshes.length - lit.length} sources, ${data.lights.length} lumières, ${data.fakes.length} fausses lumières, ${data.bulbs.length} ampoules, ${(bin.length / 1e6).toFixed(1)} Mo, ${lit.reduce((a, m) => a + m.ni / 3, 0)} triangles éclairés`);
  await browser.close();
})();
