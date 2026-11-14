/* ==================================================================
   MyLizaSwim — expérience 3D
   Défilement = la caméra glisse le long d'un rail (Catmull-Rom) qui
   relie les 9 étapes, avec un aimant doux sur chaque étape.
   Clic sur un objet / une pastille = vol jusqu'à l'objet + panneau.
================================================================== */
import * as THREE from 'three';
import { createWorld } from './world.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const TAU = Math.PI * 2;
const angleDamp = (a, b, k, dt) => {
  let d = ((b - a) % TAU + TAU + Math.PI) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-k * dt));
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function start(ctx) {
  const { STATIONS, SUBPINS, EASTER, Sound, selectTab, setProfile, closeMenu, isMenuOpen, toClassic } = ctx;
  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  // dans un cadre (aperçu, artefact), on ne touche pas à l'historique du parent
  const inFrame = (() => { try { return window.top !== window; } catch { return true; } })();
  const setHash = (id, push) => {
    try {
      if (push && !inFrame) { history.pushState({ sheet: id }, '', `#${id}`); return true; }
      history.replaceState(id ? { sheet: id } : null, '', id ? `#${id}` : location.pathname + location.search);
    } catch { /* historique indisponible : on garde l'état dans la page */ }
    return false;
  };
  const N = STATIONS.length;
  const idxOf = (id) => STATIONS.findIndex((s) => s.id === id);
  const html = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const isMobile = () => innerWidth <= 900;

  /* ---------- DOM ---------- */
  const canvas = $('#scene');
  const loader = $('#loader');
  const loaderBar = $('#loaderBar');
  const hero = $('#accueil');
  const sheet = $('#sheet');
  const sheetBody = $('#sheetBody');
  const panels = [...document.querySelectorAll('.panel')];
  const mascot = $('#mascot');
  const mascotCard = $('.mascot-card', mascot);
  const mascotText = $('#mascotText');
  const mascotLive = $('#mascotLive');
  const mascotOpen = $('#mascotOpen');
  const scrollHint = $('#scrollHint');
  const rail = $('#rail');
  const pinsEl = $('#pins');

  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-hidden', 'true');
  loaderBar.style.width = '30%';

  /* ---------- rendu ---------- */
  let mob = isMobile();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mob ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // décor immobile : les ombres sont calculées une fois (puis rafraîchies rarement), pas à chaque image
  renderer.shadowMap.autoUpdate = false;
  let shadowFrames = 3;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const world = createWorld(renderer, { quality: mob ? 'low' : 'high' });
  const { scene, dolphin } = world;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

  /* ---------- rail caméra ---------- */
  let posCurve, lookCurve;
  function buildCurves() {
    const P = STATIONS.map((s) => new THREE.Vector3(...((mob && s.camM) || s.cam)));
    const L = STATIONS.map((s) => new THREE.Vector3(...((mob && s.lookM) || s.look)));
    posCurve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
    lookCurve = new THREE.CatmullRomCurve3(L, false, 'centripetal');
  }
  const stationPose = (u, outP, outL) => {
    const t = clamp(u, 0, N - 1) / (N - 1);
    posCurve.getPoint(t, outP);
    lookCurve.getPoint(t, outL);
  };

  /* ---------- état ---------- */
  const S = {
    cur: 0, target: 0, tween: null, nearest: 0, shown: -1, open: null,
    pendingOpen: null, pendingSub: null, dir: 1,
    px: 0, py: 0, ppx: 0, ppy: 0, vx: 0, vy: 0,
    interacted: false,
  };
  let intro = null;
  let W = innerWidth, H = innerHeight;
  let sheetW = 0, sheetH = 0;

  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    const a = W / H;
    camera.aspect = a;
    camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(0.647 / a)), 38, 68);
    camera.updateProjectionMatrix();
    const m = isMobile();
    if (m !== mob || !posCurve) { mob = m; buildCurves(); }
    sheetW = sheet.offsetWidth; sheetH = sheet.offsetHeight;
    measureMascot();
  }
  on(window, 'resize', resize);

  /* ---------- navigation ---------- */
  function goTo(i, { open = false, sub = null, instant = false } = {}) {
    i = clamp(Math.round(i), 0, N - 1);
    S.pendingOpen = open ? i : null;
    S.pendingSub = sub;
    interacted();
    if (intro) finishIntro();
    const dist = Math.abs(i - S.cur);
    S.target = i;
    if (instant || reduceMotion || dist < 0.002) {
      S.cur = i; S.tween = null;
      if (open) { openSheet(i, { sub }); S.pendingOpen = null; }
      return;
    }
    S.tween = { from: S.cur, to: i, t: 0, dur: clamp(1.0 + dist * 0.32, 1.1, 2.9) };
  }

  let snapTimer = 0;
  function snap() {
    const t = S.target;
    const base = Math.floor(t + 1e-6);
    const frac = t - base;
    let r = base;
    if (frac > 1e-3) r = S.dir > 0 ? (frac > 0.1 ? base + 1 : base) : (frac < 0.9 ? base : base + 1);
    S.target = clamp(r, 0, N - 1);
  }
  function nudge(delta) {
    interacted();
    if (intro) { fastForward(); return; }
    if (S.open !== null) closeSheet();
    S.tween = null; S.pendingOpen = null;
    S.dir = Math.sign(delta) || S.dir;
    if (gestureBase === null) gestureBase = Math.round(S.target);
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => { gestureBase = null; }, 280);
    S.target = clamp(S.target + delta, Math.max(0, gestureBase - 1), Math.min(N - 1, gestureBase + 1));
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snap, 140);
  }
  let gestureBase = null;
  let gestureTimer = 0;

  on(window, 'wheel', (e) => {
    if (isMenuOpen()) return;
    if (S.open !== null && e.target.closest('.sheet')) return; // défilement natif du panneau
    e.preventDefault();
    let dy = e.deltaY;
    if (Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
    if (e.deltaMode === 1) dy *= 32; else if (e.deltaMode === 2) dy *= H;
    nudge(clamp(dy, -240, 240) * 0.0024);
  }, { passive: false });

  let touch = null;
  on(window, 'touchstart', (e) => {
    if (isMenuOpen() || e.target.closest('.sheet, .menu, .topbar')) { touch = null; return; }
    touch = { y: e.touches[0].clientY, moved: 0 };
  }, { passive: true });
  on(window, 'touchmove', (e) => {
    if (!touch) return;
    const y = e.touches[0].clientY;
    const dy = touch.y - y;
    touch.y = y;
    touch.moved += Math.abs(dy);
    if (touch.moved > 8) nudge(dy * 0.0045);
  }, { passive: true });
  on(window, 'touchend', () => { touch = null; });

  on(window, 'keydown', (e) => {
    if (e.key === 'Escape') {
      S.pendingOpen = null;
      if (isMenuOpen()) closeMenu();
      else if (S.open !== null) closeSheet();
      return;
    }
    if (isMenuOpen()) return;
    if (S.open !== null) { if (e.key === 'Tab') trapFocus(e); return; }
    const tag = e.target.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    const cur = Math.round(S.target);
    const next = ['ArrowDown', 'PageDown', 'ArrowRight'].includes(e.key) || (e.key === ' ' && !/BUTTON|A/.test(tag));
    const prev = ['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key);
    if (next || prev || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (intro) { fastForward(); return; }
      goTo(next ? cur + 1 : prev ? cur - 1 : e.key === 'Home' ? 0 : N - 1);
    }
  });

  function trapFocus(e) {
    const f = [...sheet.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // liens / boutons qui pilotent le bassin
  on(document, 'click', (e) => {
    const go = e.target.closest('[data-go]');
    const menuItem = e.target.closest('[data-menu]');
    if (!go && !menuItem) return;
    e.preventDefault();
    closeMenu();
    if (menuItem) {
      const i = +menuItem.dataset.menu;
      if (S.open !== null && i > 0) { openSheet(i); goTo(i); } else { closeSheet(); goTo(i, { open: i > 0 }); }
      return;
    }
    const i = idxOf(go.dataset.go);
    if (go.dataset.profile) setProfile(go.dataset.profile, go.dataset.pack);
    if (go.hasAttribute('data-open')) {
      if (S.open !== null) { openSheet(i); goTo(i); } else goTo(i, { open: true });
    } else {
      closeSheet();
      goTo(i);
    }
  });

  on($('.skip-link'), 'click', (e) => { e.preventDefault(); toClassic(); });

  /* ---------- feuille d'information ---------- */
  let sheetReturn = null;
  let sheetPushed = false;
  function openSheet(i, { sub = null } = {}) {
    const st = STATIONS[i];
    const panel = document.getElementById(st.id);
    if (!panel || !panel.classList.contains('panel')) return;
    const wasOpen = S.open !== null;
    panels.forEach((p) => p.classList.toggle('is-active', p === panel));
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.setAttribute('aria-labelledby', panel.getAttribute('aria-labelledby'));
    S.open = i;
    sheetBody.scrollTop = 0;
    $('#sheetCount').textContent = `${String(i).padStart(2, '0')} / ${String(N - 1).padStart(2, '0')}`;
    const prev = $('#sheetPrev'), next = $('#sheetNext');
    prev.hidden = i <= 1; next.hidden = i >= N - 1;
    if (i > 1) { prev.querySelector('span').textContent = STATIONS[i - 1].label; prev.onclick = () => { openSheet(i - 1); goTo(i - 1); }; }
    if (i < N - 1) { next.querySelector('span').textContent = STATIONS[i + 1].label; next.onclick = () => { openSheet(i + 1); goTo(i + 1); }; }
    if (!wasOpen) sheetReturn = document.activeElement;
    const h = panel.querySelector('h2');
    h.tabIndex = -1;
    requestAnimationFrame(() => h.focus({ preventScroll: true }));
    if (sub) focusSub(st.id, sub);
    // une seule entrée d'historique par ouverture : « retour » ferme le panneau
    if (location.hash !== `#${st.id}`) {
      const pushed = setHash(st.id, !wasOpen);
      if (!wasOpen) sheetPushed = pushed;
    }
    Sound.bloop(1.2);
    chrome();
  }
  function closeSheet({ fromPop = false } = {}) {
    if (S.open === null) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    S.open = null;
    if (!fromPop) {
      if (sheetPushed) history.back();
      else if (location.hash) setHash('', false);
    }
    sheetPushed = false;
    chrome();
    if (sheetReturn && document.contains(sheetReturn) && sheetReturn.offsetParent !== null) sheetReturn.focus({ preventScroll: true });
    if (sheet.contains(document.activeElement)) $('#menuBtn').focus({ preventScroll: true });
    sheetReturn = null;
  }
  on($('#sheetClose'), 'click', () => closeSheet());
  on(window, 'popstate', () => {
    const i = idxOf(location.hash.slice(1));
    if (i > 0) { openSheet(i); goTo(i); } else closeSheet({ fromPop: true });
  });
  // glisser vers le bas pour fermer (mobile)
  {
    let y0 = null;
    const bar = $('.sheet-bar', sheet);
    on(bar, 'touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    on(bar, 'touchmove', (e) => {
      if (y0 === null) return;
      const dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
      sheet.style.transition = 'none';
    }, { passive: true });
    on(bar, 'touchend', (e) => {
      if (y0 === null) return;
      const dy = e.changedTouches[0].clientY - y0;
      sheet.style.transform = ''; sheet.style.transition = '';
      y0 = null;
      if (dy > 90) closeSheet();
    });
  }
  function focusSub(id, sub) {
    if (id === 'nageurs') selectTab(sub);
    if (id === 'methode') {
      const el = document.getElementById(sub);
      if (!el) return;
      setTimeout(() => {
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
      }, 450);
    }
  }

  /* ---------- rail de progression ---------- */
  rail.innerHTML = STATIONS.map((s, i) => `<button class="rail-item" type="button" data-rail="${i}" aria-label="${esc(s.pin || s.label)}"><span class="rail-label">${esc(s.label)}</span><span class="rail-bead"></span></button>`).join('');
  const railItems = [...rail.children];
  const progress = $('#progress');
  progress.innerHTML = STATIONS.map((s, i) => `<button type="button" data-prog="${i}" aria-label="Étape ${i + 1} : ${esc(s.title || s.label)}"><i></i></button>`).join('');
  const progItems = [...progress.children];
  on(progress, 'click', (e) => {
    const b = e.target.closest('[data-prog]');
    if (!b) return;
    closeSheet();
    goTo(+b.dataset.prog);
  });
  on(rail, 'click', (e) => {
    const b = e.target.closest('[data-rail]');
    if (!b) return;
    closeSheet();
    goTo(+b.dataset.rail);
  });

  /* ---------- pastilles ---------- */
  const pins = [];
  function makePin(p) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pin is-off${p.isSub ? ' pin-sub' : ''}`;
    b.innerHTML = `<span class="pin-dot">${esc(p.num)}</span><span class="pin-text">${esc(p.text)}</span>`;
    b.setAttribute('aria-label', p.isSub ? `${p.text}, ${STATIONS[p.station].label}` : p.text);
    b.tabIndex = -1;
    on(b, 'click', () => activate(p.station, p.sub));
    on(b, 'mouseenter', () => { hoverKey = p; });
    on(b, 'mouseleave', () => { if (hoverKey === p) hoverKey = null; });
    pinsEl.append(b);
    pins.push({ ...p, el: b, vis: null });
  }
  STATIONS.forEach((s, i) => {
    if (world.anchors[s.id]) makePin({ station: i, key: s.id, text: s.pin || s.label, num: String(i), pos: world.anchors[s.id] });
    (SUBPINS[s.id] || []).forEach(([sub, label, short]) => {
      makePin({ station: i, key: s.id, sub, text: label, num: short, pos: world.anchors[`${s.id}:${sub}`], isSub: true });
    });
  });
  let hoverKey = null;

  function activate(i, sub = null) {
    if (S.open !== null && S.open !== i) { openSheet(i, { sub }); goTo(i); return; }
    goTo(i, { open: true, sub });
  }

  /* ---------- mascotte ---------- */
  let typeTimer = 0;
  let mascotH = 150, mascotW = 340;
  function measureMascot() { mascotH = mascotCard.offsetHeight || mascotH; mascotW = mascot.offsetWidth || mascotW; }
  function say(text) {
    mascotLive.textContent = text;
    clearInterval(typeTimer);
    if (reduceMotion) { mascotText.textContent = text; measureMascot(); return; }
    let i = 0;
    mascotText.innerHTML = '<span class="caret"></span>';
    typeTimer = setInterval(() => {
      i += 2;
      mascotText.innerHTML = esc(text.slice(0, i)) + (i < text.length ? '<span class="caret"></span>' : '');
      measureMascot();
      if (i >= text.length) clearInterval(typeTimer);
    }, 22);
  }
  function setMascot(i) {
    const st = STATIONS[i];
    S.shown = i;
    say(st.line);
    $('#mascotStep').textContent = `Étape ${i + 1} sur ${N}`;
    $('#mascotTitle').textContent = st.title || st.label;
    mascotOpen.textContent = st.cta || 'Découvrir';
    $('#prevBtn').disabled = i === 0;
    $('#nextBtn').disabled = i === N - 1;
  }
  on(mascotOpen, 'click', () => {
    const i = Math.round(S.cur);
    if (i === 0) goTo(1); else goTo(i, { open: true });
  });
  on($('#prevBtn'), 'click', () => goTo(Math.round(S.target) - 1));
  on($('#nextBtn'), 'click', () => goTo(Math.round(S.target) + 1));
  let mascotTimer = 0;

  /* ---------- dauphin ---------- */
  const D = {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0,
    mode: 'idle', path: null, trick: null, goal: -1, pendingGoal: null,
    phase: 0, amp: 0.025, freq: 3, orbitA: 0,
  };
  const lvl = () => world.state.level;
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  function orbitPoint(i, a, out) {
    const o = STATIONS[i].orbit;
    return out.set(o.c[0] + Math.cos(a) * o.r, o.c[1] + Math.sin(a * 2) * 0.12, o.c[2] + Math.sin(a) * o.r);
  }
  function placeDolphin(i) {
    D.goal = i; D.path = null; D.trick = null;
    if (STATIONS[i].orbit) { D.mode = 'orbit'; D.orbitA = 0; orbitPoint(i, 0, D.pos); }
    else { D.mode = 'idle'; const [x, z] = STATIONS[i].dolphin; D.pos.set(x, lvl() + 0.07, z); }
    dolphin.root.position.copy(D.pos);
  }
  // trajet : plongée, nage sous la surface sur une courbe, puis saut à l'arrivée
  function travelTo(i) {
    const st = STATIONS[i];
    const from = D.pos.clone();
    const toOrbit = !!st.orbit;
    let tx, ty, tz;
    if (toOrbit) {
      D.orbitA = Math.atan2(from.z - st.orbit.c[2], from.x - st.orbit.c[0]);
      const q = orbitPoint(i, D.orbitA, new THREE.Vector3());
      tx = q.x; ty = q.y; tz = q.z;
    } else { [tx, tz] = st.dolphin; ty = lvl() + 0.07; }
    const dx = tx - from.x, dz = tz - from.z;
    const dist = Math.hypot(dx, dz);
    const side = Math.random() < 0.5 ? -1 : 1;
    const cx = clamp(from.x + dx / 2 - dz * 0.3 * side, -3.0, 3.0);
    const cz = clamp(from.z + dz / 2 + dx * 0.3 * side, -15.2, -0.8);
    D.path = {
      fx: from.x, fy: from.y, fz: from.z, cx, cz, tx, ty, tz, t: 0, toOrbit, breached: false,
      dur: clamp(1.5 + dist * 0.22, 1.9, 4.8), h: clamp(0.75 + dist * 0.06, 0.85, 1.5),
    };
    D.mode = 'travel';
    if (from.y > lvl() - 0.12) { world.splash(from.x, from.z, 16, 0.5); Sound.splash(); }
  }
  function pathPoint(p, u, out) {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    const x = a * p.fx + b * p.cx + c * p.tx;
    const z = a * p.fz + b * p.cz + c * p.tz;
    const L = lvl();
    const LEAP = 0.74;
    let y;
    if (p.toOrbit) y = lerp(L - 0.7 * Math.sin(Math.PI * 0.5 * Math.min(u / 0.6, 1)), p.ty, smooth(0.45, 1, u));
    else if (u < LEAP) y = L - 0.72 * Math.sin(Math.PI * (u / LEAP));
    else { const k = (u - LEAP) / (1 - LEAP); y = L + 4 * p.h * k * (1 - k) - 0.18 * k; }
    if (p.fy < L - 0.2) y = lerp(p.fy, y, smooth(0, 0.3, u));
    return out.set(x, y, z);
  }
  function trick() {
    if (D.mode !== 'idle') return;
    D.trick = { t: 0, dur: 1.25, x: D.pos.x, z: D.pos.z };
    D.mode = 'trick';
    world.splash(D.pos.x, D.pos.z, 18, 0.55);
    Sound.splash();
  }
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), dir = new THREE.Vector3();
  function orient(d, dt, k) {
    const hz = Math.hypot(d.x, d.z);
    if (hz + Math.abs(d.y) < 1e-6) return;
    const prev = D.yaw;
    D.yaw = angleDamp(D.yaw, Math.atan2(-d.z, d.x), k, dt);
    const turn = ((D.yaw - prev) % TAU + TAU + Math.PI) % TAU - Math.PI;
    D.pitch = damp(D.pitch, Math.atan2(d.y, Math.max(hz, 1e-4)), k, dt);
    D.roll = damp(D.roll, clamp(-turn / Math.max(dt, 1e-3) * 0.1, -0.55, 0.55), 4, dt);
  }
  function updateDolphin(t, dt) {
    const L = lvl();
    if (!intro && D.pendingGoal !== null && (D.mode === 'idle' || D.mode === 'orbit') && t >= D.pendingGoal.at) {
      const i = D.pendingGoal.i;
      D.pendingGoal = null;
      if (i !== D.goal) { D.goal = i; if (reduceMotion) placeDolphin(i); else travelTo(i); }
    }
    let amp = 0.022, freq = 3.2;
    if (D.mode === 'travel') {
      const p = D.path;
      p.t += dt / p.dur;
      const u = Math.min(p.t, 1);
      pathPoint(p, u, D.pos);
      pathPoint(p, Math.max(u - 0.01, 0), tA);
      pathPoint(p, Math.min(u + 0.01, 1), tB);
      orient(dir.subVectors(tB, tA), dt, 9);
      amp = 0.07; freq = 10.5;
      if (!p.toOrbit && !p.breached && u > 0.74 && D.pos.y > L) { p.breached = true; world.splash(D.pos.x, D.pos.z, 20, 0.6); }
      if (p.t >= 1) {
        D.path = null;
        if (p.toOrbit) D.mode = 'orbit';
        else { D.mode = 'idle'; world.splash(D.pos.x, D.pos.z, 40, 1); Sound.splash(); }
      }
    } else if (D.mode === 'orbit') {
      D.orbitA += dt * 0.75;
      orbitPoint(D.goal, D.orbitA, D.pos);
      orbitPoint(D.goal, D.orbitA + 0.06, tB);
      orient(dir.subVectors(tB, D.pos), dt, 6);
      amp = 0.055; freq = 7;
    } else if (D.mode === 'trick') {
      const tr = D.trick;
      tr.t += dt / tr.dur;
      const u = Math.min(tr.t, 1);
      D.pos.set(tr.x, L - 0.15 + 4 * 1.2 * u * (1 - u), tr.z);
      D.pitch = (1 - 2 * u) * 1.15;
      D.roll = easeIO(u) * TAU;
      amp = 0.06; freq = 9;
      if (tr.t >= 1) { D.mode = 'idle'; D.trick = null; D.roll = 0; world.splash(tr.x, tr.z, 40, 1); Sound.splash(); }
    } else {
      D.pos.y = damp(D.pos.y, L + 0.07 + Math.sin(t * 1.7) * 0.035, 3, dt);
      const yawCam = Math.atan2(-(camera.position.z - D.pos.z), camera.position.x - D.pos.x);
      D.yaw = angleDamp(D.yaw, yawCam + 1.1, 2.0, dt);
      D.pitch = damp(D.pitch, 0.2 + Math.sin(t * 1.3) * 0.06, 3, dt);
      D.roll = damp(D.roll, Math.sin(t * 0.9) * 0.06, 3, dt);
    }
    D.amp = damp(D.amp, amp, 3, dt);
    D.freq = damp(D.freq, freq, 3, dt);
    D.phase += dt * D.freq;
    dolphin.swim.uPhase.value = D.phase;
    dolphin.swim.uAmp.value = D.amp;
    dolphin.root.position.copy(D.pos);
    dolphin.root.rotation.y = D.yaw;
    dolphin.pitch.rotation.z = D.pitch;
    dolphin.body.rotation.x = D.roll;
  }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const rootMap = new Map(world.clickables.map((c) => [c.root, c]));
  rootMap.set(dolphin.root, { dolphin: true });
  const roots = [...rootMap.keys()];
  function pick(x, y) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(roots, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !rootMap.has(o)) o = o.parent;
      if (o) return rootMap.get(o);
    }
    return null;
  }
  let hovered = null;
  let pointer = null;
  let pickQueued = false;
  on(canvas, 'pointermove', (e) => {
    S.px = (e.clientX / W) * 2 - 1;
    S.py = -((e.clientY / H) * 2 - 1);
    if (!finePointer || pickQueued) return;
    pickQueued = true;
    const { clientX, clientY } = e;
    requestAnimationFrame(() => {
      pickQueued = false;
      hovered = intro || S.open !== null ? null : pick(clientX, clientY);
      canvas.style.cursor = hovered ? 'pointer' : '';
    });
  });
  on(canvas, 'pointerleave', () => { hovered = null; canvas.style.cursor = ''; S.px = 0; S.py = 0; });
  on(canvas, 'pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  on(canvas, 'pointerup', (e) => {
    if (!pointer) return;
    const moved = Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y);
    const quick = performance.now() - pointer.t < 700;
    pointer = null;
    if (moved > 10 || !quick) return;
    if (intro) { fastForward(); return; }
    const hit = pick(e.clientX, e.clientY);
    if (!hit) { if (S.open !== null && !mob) closeSheet(); return; }
    if (hit.dolphin) {
      trick();
      say(EASTER[Math.floor(Math.random() * EASTER.length)]);
      Sound.bloop(1.5);
      return;
    }
    activate(idxOf(hit.station), hit.sub || null);
  });

  /* ---------- interface (état visuel) ---------- */
  function interacted() {
    if (S.interacted) return;
    S.interacted = true;
    scrollHint.classList.add('is-hidden');
  }
  let heroHidden = null;
  let railShown = -1;
  function chrome() {
    const atHome = Math.round(S.cur) === 0 && Math.abs(S.cur) < 0.35;
    const hideHero = !atHome || S.open !== null || isMenuOpen() || false;
    if (hideHero !== heroHidden) { heroHidden = hideHero; hero.classList.toggle('is-hidden', hideHero); hero.inert = hideHero; }
    const hideMascot = S.open !== null || isMenuOpen() || !!intro || S.shown < 0 || (mob && S.nearest === 0);
    mascot.classList.toggle('is-hidden', hideMascot);
    scrollHint.classList.toggle('is-hidden', S.interacted || !!intro || S.cur > 0.05);
    rail.style.opacity = intro ? '0' : '';
    if (railShown === S.nearest) return;
    railShown = S.nearest;
    progItems.forEach((b, i) => {
      b.classList.toggle('is-current', i === S.nearest);
      b.classList.toggle('is-past', i < S.nearest);
      if (i === S.nearest) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    railItems.forEach((b, i) => {
      b.classList.toggle('is-current', i === S.nearest);
      b.classList.toggle('is-past', i < S.nearest);
      if (i === S.nearest) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  const v = new THREE.Vector3();
  function project(p) {
    v.copy(p).project(camera);
    return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z];
  }
  function updatePins() {
    // pas de pastilles dans le salon ni sur la terrasse : on ne voit pas le bassin
    const hideAll = S.open !== null || isMenuOpen() || !!intro || S.cur < 0.55 || S.cur > N - 1.45;
    const overview = false;
    const atStation = Math.abs(S.cur - Math.round(S.cur)) < 0.18;
    const heroBox = !heroHidden ? hero.getBoundingClientRect() : null;
    const placed = [];
    pins.forEach((p) => {
      let state = 'off';
      if (!hideAll) {
        if (p.isSub) state = atStation && Math.round(S.cur) === p.station ? 'on' : 'off';
        else if (overview) state = 'on';
        else if (p.station === S.nearest) state = SUBPINS[p.key] && atStation ? 'off' : 'current';
        else state = S.cur > N - 1.5 ? 'off' : 'dim';
      }
      let [sx, sy, sz] = project(p.pos);
      let x0 = sx - 22;
      if (sz > 1 || sx < 20 || sx > W - 20 || sy < 70 || sy > H - 20) state = 'off';
      if (heroBox && state !== 'off' && sx > heroBox.left - 20 && sx < heroBox.right && sy > heroBox.top && sy < heroBox.bottom + 10) state = 'off';
      const hov = hoverKey === p || (hovered && !hovered.dolphin && hovered.station === p.key && (!p.isSub ? !hovered.sub || !SUBPINS[p.key] : hovered.sub === p.sub));
      if (state !== p.vis) {
        p.vis = state;
        p.el.classList.toggle('is-off', state === 'off');
        p.el.classList.toggle('is-dim', state === 'dim');
        p.el.classList.toggle('is-current', state === 'current');
        p.el.tabIndex = state === 'off' ? -1 : 0;
        p.w = 0;
      }
      p.el.classList.toggle('is-hover', !!hov);
      // évite que deux pastilles se chevauchent : on décale vers le bas
      if (state !== 'off') {
        if (!p.w) { p.w = p.el.offsetWidth || 160; p.h = p.el.offsetHeight || 44; }
        x0 = clamp(sx - 22, 8, W - p.w - (mob ? 8 : 84));
        for (const r of placed) {
          const y0 = sy - p.h / 2;
          if (x0 < r.x1 && x0 + p.w > r.x0 && y0 < r.y1 && y0 + p.h > r.y0) sy = r.y1 + p.h / 2 + 6;
        }
        placed.push({ x0, x1: x0 + p.w, y0: sy - p.h / 2, y1: sy + p.h / 2 });
      }
      p.el.style.transform = `translate3d(${x0.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translateY(-50%)`;
    });
  }

  /* ---------- intro : la caméra entre doucement dans le salon ---------- */
  const INTRO_OFF = new THREE.Vector3(0.9, 0.35, 2.4);
  function startIntro() {
    intro = { t: 0, speed: 1, dur: 2.8, hero: false };
    hero.classList.add('is-intro');
  }
  function fastForward() { if (intro) intro.speed = 4; }
  function finishIntro() {
    if (!intro) return;
    intro = null;
    hero.classList.remove('is-intro');
    try { sessionStorage.setItem('mls-intro', '1'); } catch { /* navigation privée */ }
    setMascot(Math.round(S.cur));
    chrome();
  }
  function stepIntro(dt) {
    intro.t += dt * intro.speed;
    if (!intro.hero && intro.t > 0.7) { intro.hero = true; hero.classList.remove('is-intro'); }
    if (intro.t >= intro.dur) finishIntro();
  }

  /* ---------- caméra ---------- */
  const P = new THREE.Vector3(), L = new THREE.Vector3(), P0 = new THREE.Vector3(), L0 = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  const view = { x: 0, y: 0 };
  function frameOffset(i) {
    if (!mob) return i === 0 ? [-0.12, 0] : [0, 0];
    return i === 0 ? [0, -0.1] : [0, 0.07];
  }
  function updateCamera(t, dt) {
    if (intro) {
      const k = easeOut(clamp(intro.t / 2.6, 0, 1));
      stationPose(0, P0, L);
      P.copy(P0).addScaledVector(INTRO_OFF, 1 - k);
    } else {
      stationPose(S.cur, P, L);
    }
    if (finePointer && !reduceMotion) {
      S.ppx = damp(S.ppx, S.px, 2.2, dt);
      S.ppy = damp(S.ppy, S.py, 2.2, dt);
    }
    camera.position.copy(P);
    camera.lookAt(L);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const breathe = reduceMotion ? 0 : Math.sin(t * 0.45) * 0.03;
    camera.position.addScaledVector(right, S.ppx * 0.26).addScaledVector(up, S.ppy * 0.14 + breathe);
    camera.lookAt(L);

    const f = Math.floor(S.cur), fr = S.cur - f;
    const a = frameOffset(f), b = frameOffset(Math.min(f + 1, N - 1));
    let ox = lerp(a[0], b[0], fr), oy = lerp(a[1], b[1], fr);
    if (S.open !== null) {
      if (!mob) ox += (sheetW + 12) / (2 * W);
      else {
        // centre l'objet dans la bande visible entre la barre du haut et la feuille
        const top = 64, bottom = H - sheetH - 8;
        oy = (H / 2 - (top + (bottom - top) * 0.55)) / H;
      }
    }
    view.x = damp(view.x, ox, 4.5, dt);
    view.y = damp(view.y, oy, 4.5, dt);
    camera.setViewOffset(W, H, view.x * W, view.y * H, W, H);
    camera.updateMatrixWorld();
  }

  /* ---------- boucle ---------- */
  function step(t, dt) {
    if (intro) stepIntro(dt);
    else if (S.tween) {
      const tw = S.tween;
      tw.t += dt / tw.dur;
      const k = easeIO(Math.min(tw.t, 1));
      S.cur = lerp(tw.from, tw.to, k);
      if (S.pendingOpen !== null && tw.t > 0.62) { openSheet(S.pendingOpen, { sub: S.pendingSub }); S.pendingOpen = null; }
      if (tw.t >= 1) { S.cur = tw.to; S.tween = null; }
    } else if (reduceMotion) {
      // mouvement réduit : pas de glissement continu, coupe franche une fois le défilement posé
      if (Number.isInteger(S.target)) S.cur = S.target;
      if (S.pendingOpen !== null && S.cur === S.pendingOpen) { openSheet(S.pendingOpen, { sub: S.pendingSub }); S.pendingOpen = null; }
    } else {
      S.cur = damp(S.cur, S.target, 4.2, dt);
      if (Math.abs(S.cur - S.target) < 4e-4) S.cur = S.target;
      if (S.pendingOpen !== null && Math.abs(S.cur - S.pendingOpen) < 0.02) { openSheet(S.pendingOpen, { sub: S.pendingSub }); S.pendingOpen = null; }
    }
    const n = Math.round(S.cur);
    if (n !== S.nearest) {
      S.nearest = n;
      Sound.bloop(0.9 + n * 0.06);
      clearTimeout(mascotTimer);
      mascotTimer = setTimeout(() => { if (!intro) setMascot(S.nearest); }, 160);
    }
    chrome();
    // le dauphin rejoint l'étape visée une fois le défilement posé
    const goal = Math.abs(S.target - Math.round(S.target)) < 1e-3 ? Math.round(S.target) : null;
    if (goal !== null && goal !== D.goal && (!D.pendingGoal || D.pendingGoal.i !== goal)) D.pendingGoal = { i: goal, at: t + 0.12 };
  }

  /* ---------- garde-fous : appareil lent, contexte WebGL perdu, chargement bloqué ---------- */
  const toast = $('#toast');
  function showToast(text) {
    $('#toastText').textContent = text;
    toast.hidden = false;
  }
  on($('#toastYes'), 'click', () => { toast.hidden = true; toClassic(); });
  on($('#toastNo'), 'click', () => { toast.hidden = true; });
  const Q = { level: 0, frames: 0, time: 0, warm: 0, last: performance.now() };
  const autoQuality = !navigator.webdriver; // pas d'adaptation pendant les tests automatisés
  function watchPerf() {
    const now = performance.now();
    const real = Math.min((now - Q.last) / 1000, 0.5);
    Q.last = now;
    if (!autoQuality || intro || Q.level >= 2 || document.hidden) return;
    Q.warm += real;
    if (Q.warm < 3) return;
    Q.frames++; Q.time += real;
    if (Q.time < 2) return;
    const fps = Q.frames / Q.time;
    Q.frames = 0; Q.time = 0;
    if (Q.level === 0 && fps < 32) {
      Q.level = 1;
      renderer.setPixelRatio(Math.min(1, devicePixelRatio || 1));
      world.setLowFx(true);
      resize();
    } else if (Q.level === 1 && fps < 20) {
      Q.level = 2;
      renderer.setPixelRatio(0.75);
      resize();
      let asked = false;
      try { asked = !!sessionStorage.getItem('mls-slow'); sessionStorage.setItem('mls-slow', '1'); } catch { /* */ }
      if (!asked) showToast('La visite 3D semble ralentir sur cet appareil. Voulez-vous passer à la version sans 3D ? Tout le contenu y est.');
    }
  }
  on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); toClassic(); });
  const safety = setTimeout(() => { if (!loader.classList.contains('is-done')) toClassic(); }, 25000);

  const clock = new THREE.Clock();
  let raf = 0;
  let uwShown = false;
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    watchPerf();
    const t = clock.elapsedTime;
    step(t, dt);
    updateCamera(t, dt);
    world.update(t, dt, camera);
    updateDolphin(t, dt);
    if (world.state.underwater !== uwShown) {
      uwShown = world.state.underwater;
      html.classList.toggle('underwater', uwShown);
      Sound.setUnderwater?.(uwShown);
    }
    // survol : petit « pop » de l'objet
    world.clickables.forEach((c) => {
      const target = hovered && hovered.root === c.root ? 1.06 : 1;
      const s = damp(c.root.scale.x, target, 10, dt);
      c.root.scale.setScalar(s);
    });
    if (shadowFrames > 0) { renderer.shadowMap.needsUpdate = true; shadowFrames--; }
    renderer.render(scene, camera);
    updatePins();
  }
  on(document, 'visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { clock.getDelta(); frame(); }
  });

  /* ---------- démarrage ---------- */
  resize();
  const deep = idxOf(location.hash.slice(1));
  let firstVisit = true;
  try { firstVisit = !sessionStorage.getItem('mls-intro'); } catch { /* */ }
  const playIntro = firstVisit && !reduceMotion && deep <= 0;

  if (deep > 0) { S.cur = S.target = S.nearest = deep; }
  placeDolphin(Math.round(S.cur));
  stationPose(S.cur, P, L);
  camera.position.copy(P); camera.lookAt(L);

  world.ready.then(() => {
    shadowFrames = 3;
    loaderBar.style.width = '70%';
    return renderer.compileAsync ? renderer.compileAsync(scene, camera) : null;
  }).catch(() => null).then(() => {
    loaderBar.style.width = '100%';
    if (playIntro) startIntro();
    else { setMascot(Math.round(S.cur)); }
    chrome();
    frame();
    clearTimeout(safety);
    setTimeout(() => {
      loader.classList.add('is-done');
      if (deep > 0) openSheet(deep);
    }, 250);
  });

  function destroy() {
    ac.abort();
    cancelAnimationFrame(raf); raf = -1;
    clearTimeout(snapTimer); clearTimeout(mascotTimer); clearInterval(typeTimer);
    world.stop();
    renderer.dispose();
    renderer.forceContextLoss();
    panels.forEach((p) => p.classList.remove('is-active'));
    sheet.classList.remove('is-open');
    ['role', 'aria-modal', 'aria-hidden', 'aria-labelledby'].forEach((a) => sheet.removeAttribute(a));
    sheet.style.transform = '';
    pinsEl.innerHTML = '';
    rail.innerHTML = '';
    progress.innerHTML = '';
    toast.hidden = true;
    clearTimeout(safety);
    hero.classList.remove('is-hidden', 'is-intro');
    hero.inert = false;
    mascot.classList.add('is-hidden');
    scrollHint.classList.add('is-hidden');
    html.classList.remove('underwater');
    if (location.hash) setHash('', false);
  }

  return { chrome, goTo, destroy };
}
