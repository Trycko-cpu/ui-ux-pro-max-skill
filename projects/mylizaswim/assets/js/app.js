/* ==================================================================
   MyLizaSwim — orchestration : caméra, défilement, mascotte, panneaux
================================================================== */

/* ------------------------------------------------------------------
   À COMPLÉTER AVANT MISE EN LIGNE
------------------------------------------------------------------- */
const CONFIG = {
  // URL d'un service de formulaire (Formspree, Basin, Netlify Forms, back-office…).
  // Vide = le formulaire affiche une confirmation « démo » et n'envoie rien.
  formEndpoint: '',
};

// Grille tarifaire : PRIX INDICATIFS À REMPLACER par la vraie grille de la coach.
const PRICING = {
  who: [
    { id: 'aquababy', label: 'Aquababy', age: '3 mois – 1 an', duration: '30 min' },
    { id: 'enfant', label: 'Enfant', age: '1 – 9 ans', duration: '30 min' },
    { id: 'jeune', label: 'Jeune', age: '9 – 18 ans', duration: '45 min' },
    { id: 'adulte', label: 'Adulte', age: '18 ans et +', duration: '45 min' },
  ],
  packs: [
    { id: 'unite', label: 'Premier cours', name: 'Séance à l\'unité', n: 1 },
    { id: '5', label: '5 séances', name: 'Carnet 5 séances', n: 5 },
    { id: '10', label: '10 séances', name: 'Carnet 10 séances', n: 10 },
  ],
  prices: {
    aquababy: { unite: 35, 5: 165, 10: 310 },
    enfant: { unite: 38, 5: 180, 10: 340 },
    jeune: { unite: 45, 5: 215, 10: 410 },
    adulte: { unite: 50, 5: 235, 10: 450 },
  },
};

/* ------------------------------------------------------------------
   Les étapes du bassin. cam / look = position et cible de la caméra,
   camM / lookM = variantes mobile, dolphin = [x, z] dans l'eau.
------------------------------------------------------------------- */
const STATIONS = [
  {
    id: 'accueil', label: 'Accueil', cta: 'Commencer la visite',
    cam: [0, 6.1, 8.2], look: [0, -1.5, -7.4], camM: [0, 12.5, 12.0], lookM: [0, -1.2, -6.9],
    dolphin: [2.5, -3.2],
    line: 'Bienvenue chez MyLizaSwim ! Je suis votre guide. Cliquez sur un objet du bassin, ou faites défiler pour plonger.',
  },
  {
    id: 'methode', label: 'Ma méthode',
    cam: [0, 2.9, -1.4], look: [0, -0.35, -7.8], camM: [0, 5.4, 2.6], lookM: [0, -0.7, -7.5],
    dolphin: [0, -4.6],
    line: 'Ces trois bouées, c\'est la méthode de Maliza : Sensation, Expression, Application. Touchez-en une !',
  },
  {
    id: 'coach', label: 'Votre coach',
    cam: [1.3, 2.6, -2.7], look: [5.7, 1.75, -7.7], camM: [0.6, 3.2, -1.8], lookM: [5.7, 1.6, -7.6],
    dolphin: [2.5, -5.4],
    line: 'Sur la grande chaise, c\'est la place de Maliza. Venez découvrir son histoire : elle aussi a appris à nager !',
  },
  {
    id: 'nageurs', label: 'Quel nageur êtes-vous ?', pin: 'Quel nageur êtes-vous ?',
    cam: [0, 1.5, -5.6], look: [0, 0.55, 0.9], camM: [0, 2.9, -9.4], lookM: [0, 0.45, 0.9],
    dolphin: [-2.2, -1.0],
    line: 'Trois plots, trois couloirs. Aquababy, Enfants, Jeunes & adultes : lequel est le vôtre ?',
  },
  {
    id: 'premier-cours', label: 'Le premier cours',
    cam: [-0.3, 2.0, -0.4], look: [-3.3, -0.15, -3.95], camM: [0.4, 2.6, 0.6], lookM: [-3.2, -0.2, -4.0],
    dolphin: [-2.5, -5.6],
    line: 'L\'échelle et la planche, c\'est le tout premier pas. Voici comment se passe le premier cours.',
  },
  {
    id: 'tarifs', label: 'Tarifs',
    cam: [2.9, 2.0, -9.6], look: [5.9, 0.55, -12.3], camM: [2.0, 2.9, -8.6], lookM: [5.9, 0.5, -12.3],
    dolphin: [2.7, -11.3],
    line: 'Une serviette, cinq, dix… Sur le banc, je vous aide à choisir la formule qui vous va.',
  },
  {
    id: 'avis', label: 'Avis',
    cam: [0, 2.9, -10.9], look: [0, 1.95, -19.4], camM: [0, 3.2, -8.4], lookM: [0, 1.9, -19.4],
    dolphin: [-2.5, -14.0],
    line: 'Le tableau des résultats ! Voici ce que disent les familles.',
  },
  {
    id: 'faq', label: 'Questions', pin: 'Questions fréquentes',
    cam: [2.7, 2.1, -15.0], look: [6.3, 1.1, -17.0], camM: [2.2, 2.5, -14.6], lookM: [6.3, 1.05, -17.0],
    dolphin: [2.5, -12.4],
    line: 'Une question ? La bouée est là pour ça. Je vous ai préparé les réponses.',
  },
  {
    id: 'reserver', label: 'Réserver', cta: 'Réserver',
    cam: [0, 15.5, -3.6], look: [0, 0, -8.4], camM: [0, 21, -3.0], lookM: [0, 0, -8.6],
    dolphin: [0, -8.2],
    line: 'Prêt·e à vous jeter à l\'eau ? Laissez vos coordonnées, Maliza vous recontacte très vite.',
  },
];
const N = STATIONS.length;
const idxOf = (id) => STATIONS.findIndex((s) => s.id === id);

const SUBPINS = {
  methode: [['sensation', 'Sensation', 'S'], ['expression', 'Expression', 'E'], ['application', 'Application', 'A']],
  nageurs: [['aquababy', 'Aquababy', '1'], ['enfants', 'Enfants', '2'], ['adultes', 'Jeunes & adultes', '3']],
};

const EASTER = [
  'Splash ! Encore ?',
  'Je nage, tu nages, nous nageons !',
  'Un dauphin en verre, ça ne craint pas l\'eau. Ni les câlins.',
  'Hihi, ça chatouille !',
];

/* ------------------------------------------------------------------ */
const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => innerWidth <= 900;
const finePointer = matchMedia('(pointer: fine)').matches;

$('#year').textContent = new Date().getFullYear();

/* ==================================================================
   Composants partagés (mode 3D et mode classique)
================================================================== */
// --- onglets « Quel nageur êtes-vous ? »
const tabs = $$('.tabs [role="tab"]');
function selectTab(key, focus = false) {
  tabs.forEach((t) => {
    const on = t.id === `tab-${key}`;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    if (on && focus) t.focus();
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t.id.slice(4)));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(n.id.slice(4), true);
  });
});

// --- grille tarifaire guidée
const guide = { who: 'enfant', pack: 'unite' };
const fmt = (n) => `${n.toLocaleString('fr-FR')} €`;
function renderGuide() {
  $('#segWho').innerHTML = PRICING.who.map((w) => `<button type="button" data-who="${w.id}" aria-pressed="${guide.who === w.id}">${w.label}</button>`).join('');
  $('#segPack').innerHTML = PRICING.packs.map((p) => `<button type="button" data-pack="${p.id}" aria-pressed="${guide.pack === p.id}">${p.label}</button>`).join('');
  const w = PRICING.who.find((x) => x.id === guide.who);
  const p = PRICING.packs.find((x) => x.id === guide.pack);
  const price = PRICING.prices[w.id][p.id];
  const unit = PRICING.prices[w.id].unite;
  const per = Math.round((price / p.n) * 100) / 100;
  const save = unit * p.n - price;
  const card = $('#priceCard');
  card.innerHTML = `
    <p class="pc-label">Votre formule</p>
    <p class="pc-name">${p.name} · ${w.label} <span style="opacity:.7;font-weight:500">(${w.age})</span></p>
    <div class="pc-price"><strong>${fmt(price)}</strong>${p.n > 1 ? `<span class="pc-unit">soit ${fmt(per)} la séance</span>` : ''}</div>
    ${save > 0 ? `<span class="pc-save">${fmt(save)} d'économie</span>` : ''}
    <ul>
      <li>${p.n > 1 ? `${p.n} séances` : 'Une séance'} de ${w.duration}</li>
      <li>Programme adapté à votre niveau</li>
      <li>Un suivi à votre rythme</li>
    </ul>
    <a class="btn btn-cta" href="#reserver" data-go="reserver" data-open data-profile="${w.id}" data-pack="${p.id}">Réserver cette formule</a>`;
  card.classList.remove('is-swap'); void card.offsetWidth; card.classList.add('is-swap');
}
$('#priceGuide').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.who) guide.who = b.dataset.who;
  if (b.dataset.pack) guide.pack = b.dataset.pack;
  renderGuide();
  const sel = b.dataset.who ? `[data-who="${b.dataset.who}"]` : `[data-pack="${b.dataset.pack}"]`;
  $(sel, $('#priceGuide'))?.focus();
});
renderGuide();

function setProfile(profile, pack) {
  const map = { enfants: 'enfant', adultes: 'adulte' };
  const v = map[profile] || profile;
  if (v && $(`#f-who option[value="${v}"]`)) $('#f-who').value = v;
  if (pack !== undefined && $(`#f-pack option[value="${pack}"]`)) $('#f-pack').value = pack;
}

// --- formulaire de réservation
const form = $('#bookForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const checks = [
    ['#f-name', '#e-name', (v) => v.trim().length >= 2],
    ['#f-contact', '#e-contact', (v) => /^\S+@\S+\.\S+$/.test(v.trim()) || v.replace(/\D/g, '').length >= 9],
    ['#f-ok', '#e-ok', (_, el) => el.checked],
  ];
  let firstBad = null;
  checks.forEach(([f, err, ok]) => {
    const el = $(f);
    const good = ok(el.value, el);
    el.setAttribute('aria-invalid', String(!good));
    $(err).hidden = good;
    if (!good) el.setAttribute('aria-describedby', err.slice(1)); else el.removeAttribute('aria-describedby');
    if (!good && !firstBad) firstBad = el;
  });
  if (firstBad) { firstBad.focus(); return; }
  const data = Object.fromEntries(new FormData(form));
  const first = data.name.trim().split(/\s+/)[0];
  let sent = false;
  if (CONFIG.formEndpoint) {
    try {
      const r = await fetch(CONFIG.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
      sent = r.ok;
    } catch { sent = false; }
    if (!sent) { $('#formDoneText').textContent = 'Oups, l\'envoi n\'a pas fonctionné. Réessayez dans un instant.'; }
  }
  form.hidden = true;
  const done = $('#formDone');
  done.hidden = false;
  if (sent || !CONFIG.formEndpoint) {
    $('#formDoneText').textContent = `Merci ${first} ! Votre demande est bien notée, je vous recontacte très vite.${CONFIG.formEndpoint ? '' : ' (Démo : formulaire pas encore connecté.)'}`;
  }
  done.focus();
  Sound.splash?.();
});
['#f-name', '#f-contact', '#f-ok'].forEach((s) => $(s).addEventListener('input', (e) => {
  if (e.target.getAttribute('aria-invalid') === 'true') { e.target.setAttribute('aria-invalid', 'false'); $(`#e-${s.slice(3)}`).hidden = true; }
}));

// --- menu
const menu = $('#menu');
const menuBtn = $('#menuBtn');
$('#menuList').innerHTML = STATIONS.map((s, i) => `<li style="animation-delay:${i * 35}ms"><button type="button" data-menu="${i}"><span>${String(i).padStart(2, '0')}</span>${s.pin || s.label}</button></li>`).join('');
let menuOpen = false;
let menuReturn = null;
function openMenu() {
  menuOpen = true; menu.hidden = false; html.classList.add('menu-open');
  menuBtn.setAttribute('aria-expanded', 'true'); menuBtn.setAttribute('aria-label', 'Fermer le menu');
  menuReturn = document.activeElement;
  $('#menuList button')?.focus();
  app?.chrome();
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; menu.hidden = true; html.classList.remove('menu-open');
  menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-label', 'Ouvrir le menu');
  menuReturn?.focus?.();
  app?.chrome();
}
menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); });

// --- bascule 3D / classique
const classicBtn = $('#classicBtn');
if (html.classList.contains('classic')) classicBtn.textContent = 'Version 3D';
classicBtn.addEventListener('click', () => {
  location.search = html.classList.contains('classic') ? '' : '?classique';
});

/* ==================================================================
   Son (désactivé par défaut, synthétisé : aucun fichier audio)
================================================================== */
const Sound = (() => {
  let ctx, master, on = false;
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
    const lfoG = ctx.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(lp.frequency);
    const g = ctx.createGain(); g.gain.value = 0.32;
    src.connect(lp).connect(g).connect(master);
    src.start(); lfo.start();
  }
  function toggle() {
    if (!ctx) init();
    on = !on;
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.25);
    return on;
  }
  function bloop(p = 1) {
    if (!on) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300 * p, t); o.frequency.exponentialRampToValueAtTime(780 * p, t + 0.11);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.22);
  }
  function splash() {
    if (!on) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const g = ctx.createGain(); g.gain.value = 0.35;
    s.connect(bp).connect(g).connect(master); s.start(t);
  }
  return { toggle, bloop, splash };
})();
const soundBtn = $('#soundBtn');
soundBtn.addEventListener('click', () => {
  const on = Sound.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Couper le son de l\'eau' : 'Activer le son de l\'eau');
});

/* ==================================================================
   Démarrage
================================================================== */
let app = null;
function webglOK() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

if (html.classList.contains('classic') || !webglOK()) {
  html.classList.add('classic');
  classicBtn.textContent = 'Version 3D';
  initClassic();
} else {
  import('./scene-app.js')
    .then((m) => { app = m.start({ STATIONS, SUBPINS, EASTER, Sound, selectTab, setProfile, closeMenu, openMenu, isMenuOpen: () => menuOpen }); })
    .catch((err) => {
      console.error(err);
      html.classList.add('classic');
      $('#loader')?.classList.add('is-done');
      initClassic();
    });
}

function initClassic() {
  $('#loader')?.classList.add('is-done');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-go]');
    if (a) {
      setProfile(a.dataset.profile, a.dataset.pack);
      closeMenu();
      return; // lien d'ancre natif
    }
    const m = e.target.closest('[data-menu]');
    if (m) {
      closeMenu();
      const id = STATIONS[+m.dataset.menu].id;
      document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

