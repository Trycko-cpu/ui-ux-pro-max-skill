/* ==================================================================
   MyLizaSwim — orchestration : caméra, défilement, mascotte, panneaux
================================================================== */

/* ------------------------------------------------------------------
   À COMPLÉTER AVANT MISE EN LIGNE
------------------------------------------------------------------- */
const CONFIG = {
  // URL d'un service de formulaire (Formspree, Basin, Netlify Forms…).
  // Vide = le formulaire affiche une confirmation « démo » et n'envoie rien.
  formEndpoint: '',
  // Numéro WhatsApp d'Emmy, format international sans « + » (ex. "32470123456").
  // Vide = le lien WhatsApp reste masqué.
  whatsapp: '',
};

// Grille d'Emmy (reprise de l'ancien site). null = formule non proposée.
const PRICES = {
  piscine: { 1: { 30: 17, 60: 35, 10: 200 }, 2: { 30: 20, 60: 60, 10: 300 }, 3: { 30: 40, 60: 80, 10: 390 } },
  domicile: { 1: { 30: null, 60: 45, 10: 425 }, 2: { 30: null, 60: 70, 10: 660 }, 3: { 30: null, 60: 96, 10: 900 } },
};
const PRICE_NOTES = {
  piscine: 'Le forfait de 10 leçons se prend sur un mois. Les prix peuvent évoluer.',
  domicile: 'Le forfait de 10 leçons se prend sur un mois. Hors Bruxelles, le déplacement est compté 15 € par km.',
};
const GROUP = { 1: 'Solo', 2: 'Duo', 3: 'Trio' };
const FORMULA = { 30: '30 minutes', 60: '1 heure', 10: '10 leçons' };

/* ------------------------------------------------------------------
   Les étapes. cam / look = position et cible de la caméra,
   camM / lookM = variantes mobile, fov / fovM = focale propre à l'étape,
   dolphin = [x, z] dans l'eau, orbit = ronde sous l'eau.
------------------------------------------------------------------- */
const STATIONS = [
  {
    id: 'accueil', label: 'Accueil', title: 'Bienvenue', cta: 'Commencer la visite',
    cam: [1.6, 1.9, 13.3], look: [-0.4, 1.2, 3.0], camM: [0.8, 1.9, 13.6], lookM: [-0.6, 1.15, 3.0],
    dolphin: [0, -3.0],
    line: 'Faites défiler pour entrer dans la piscine. Chaque objet du bassin ouvre une fiche.',
  },
  {
    // vue axiale, à hauteur d'homme, comme en entrant dans le hall
    id: 'methode', label: 'Ma méthode', title: 'Ma méthode', cta: 'Voir la méthode',
    cam: [0, 1.75, 2.3], look: [0, 1.15, -14], camM: [0, 1.85, 0.2], lookM: [0, 0.95, -14],
    fov: 50, fovM: 72,
    dolphin: [0, -4.6],
    line: 'Ces trois lumières sur l\'eau, ce sont les trois étapes de la méthode d\'Emmy.',
  },
  {
    id: 'coach', label: 'Votre coach', title: 'Votre coach', cta: 'Rencontrer Emmy',
    cam: [1.2, 2.5, -3.2], look: [5.0, 1.6, -7.7], camM: [0.6, 3.0, -2.2], lookM: [5.0, 1.5, -7.6],
    dolphin: [2.5, -5.4],
    line: 'Voici la chaise d\'Emmy. Découvrez qui vous accompagnera dans l\'eau.',
  },
  {
    id: 'nageurs', label: 'Pour qui ?', pin: 'Pour qui ?', title: 'Pour qui ?', cta: 'Voir les cours',
    cam: [0, 1.5, -5.6], look: [0, 0.55, 0.9], camM: [0, 2.9, -9.4], lookM: [0, 0.45, 0.9],
    dolphin: [-2.2, -1.0],
    line: 'Un plot par âge : bébés nageurs, enfants, ados et adultes. Choisissez le vôtre.',
  },
  {
    // la caméra passe sous la surface : le dauphin fait sa ronde autour de l'échelle
    id: 'premier-cours', label: 'Le premier cours', title: 'Le premier cours', cta: 'Voir le déroulé',
    cam: [-0.7, -0.9, -7.0], look: [-3.2, -0.62, -3.0], camM: [-0.5, -0.95, -7.6], lookM: [-3.1, -0.62, -3.1],
    orbit: { c: [-2.5, -0.85, -3.7], r: 0.75 },
    line: 'On passe sous l\'eau. C\'est ici que commence le premier cours.',
  },
  {
    id: 'tarifs', label: 'Tarifs', title: 'Tarifs', cta: 'Voir les tarifs',
    cam: [2.4, 2.0, -9.2], look: [5.0, 0.55, -12.3], camM: [1.8, 2.8, -8.4], lookM: [5.0, 0.5, -12.3],
    dolphin: [2.6, -11.0],
    line: 'Sur le banc, une pile de serviettes par formule : seul, à deux ou à trois.',
  },
  {
    id: 'avis', label: 'Avis', title: 'Avis', cta: 'Lire les avis',
    cam: [-1.2, 1.9, -14.0], look: [-4.7, 1.85, -19.9], camM: [-0.6, 2.2, -12.6], lookM: [-4.7, 1.8, -19.9],
    dolphin: [-2.5, -13.8],
    line: 'Sur l\'écran défilent les messages des parents.',
  },
  {
    id: 'faq', label: 'Questions', pin: 'Questions fréquentes', title: 'Questions fréquentes', cta: 'Voir les questions',
    cam: [1.4, 1.75, -15.4], look: [4.7, 1.45, -19.9], camM: [0.8, 2.0, -14.4], lookM: [4.7, 1.4, -19.9],
    dolphin: [2.5, -14.2],
    line: 'Les questions qu\'on pose le plus souvent à Emmy, avec ses réponses.',
  },
  {
    id: 'reserver', label: 'Réserver', title: 'Réserver', cta: 'Choisir mon cours',
    cam: [0.7, 1.7, -23.2], look: [-0.6, 0.7, -31.5], camM: [0.5, 2.0, -22.4], lookM: [-0.5, 0.7, -31.5],
    dolphin: [0, -10.0],
    line: 'La visite est terminée. Choisissez votre cours, Emmy vous recontacte pour fixer la date.',
  },
];
const N = STATIONS.length;
const idxOf = (id) => STATIONS.findIndex((s) => s.id === id);

const SUBPINS = {
  methode: [['sensation', 'Sensation', 'S'], ['expression', 'Expression', 'E'], ['application', 'Application', 'A']],
  nageurs: [['aquababy', 'Bébés nageurs', '1'], ['enfants', 'Enfants', '2'], ['adultes', 'Ados et adultes', '3']],
};

const EASTER = [
  'Une vrille, rien que pour vous.',
  'Encore une ? D\'accord.',
];

/* ------------------------------------------------------------------ */
const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => `${n} €`;

$('#year').textContent = new Date().getFullYear();

/* ==================================================================
   Composants des fiches (mode 3D et mode classique)
================================================================== */
// --- « Pour qui ? » : la carte du couloir choisi passe au premier plan
function selectTab(key) {
  $$('.lane-card').forEach((c) => c.classList.toggle('is-picked', c.id === `lane-${key}`));
  const card = $(`#lane-${key}`);
  if (card) setTimeout(() => card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }), 350);
}

// --- tarifs : au bassin / chez vous
let place = 'piscine';
function renderPrices(animate = true) {
  const t = PRICES[place];
  const cols = $('#priceCols');
  cols.innerHTML = [1, 2, 3].map((n) => {
    const half = t[n][30];
    return `<div class="pcol"><span class="pdots" aria-hidden="true">${'<i></i>'.repeat(n)}</span><h3>${GROUP[n]}</h3>
      <p class="pwho">${n} personne${n > 1 ? 's' : ''}</p><p class="pbig">${t[n][60]}<small>€</small></p><p class="punit">l'heure</p>
      <dl><div><dt>30 min</dt>${half == null ? '<dd class="off" aria-label="non proposé">—</dd>' : `<dd>${fmt(half)}</dd>`}</div>
      <div><dt>10 leçons</dt><dd>${fmt(t[n][10])}</dd></div></dl></div>`;
  }).join('');
  $('#priceNote').textContent = PRICE_NOTES[place];
  $$('#tarifs .toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.place === place)));
  if (animate) { cols.classList.remove('is-swap'); void cols.offsetWidth; cols.classList.add('is-swap'); }
}
$('#tarifs .toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]');
  if (!b) return;
  place = b.dataset.place;
  renderPrices();
  setBooking({ place });
});
renderPrices(false);

// --- réservation en trois choix, prix en direct
const booking = { place: 'piscine', n: 1, f: 60 };
const waLink = $('#waLink');
function bookingSummary() {
  const what = `${GROUP[booking.n]}, ${booking.place === 'piscine' ? 'à la piscine' : 'chez vous'}, ${FORMULA[booking.f]}`;
  return { what, price: PRICES[booking.place][booking.n][booking.f] };
}
function setBooking(patch = {}) {
  Object.assign(booking, patch);
  if (PRICES[booking.place][booking.n][booking.f] == null) booking.f = 60;
  $$('#bookForm .chips').forEach((group) => {
    const name = group.dataset.name;
    $$('button', group).forEach((b) => {
      const v = name === 'place' ? b.dataset.v : Number(b.dataset.v);
      b.setAttribute('aria-pressed', String(booking[name] === v));
      if (name === 'f') b.disabled = PRICES[booking.place][booking.n][v] == null;
    });
  });
  const { what, price } = bookingSummary();
  $('#bookWhat').textContent = what;
  $('#bookPrice').textContent = fmt(price);
  if (CONFIG.whatsapp) {
    const who = $('#f-name').value.trim();
    const text = `Bonjour Emmy${who ? `, c'est ${who}` : ''}. J'aimerais réserver un cours : ${what.toLowerCase()} (${fmt(price)}). Quand seriez-vous disponible ?`;
    waLink.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
    waLink.hidden = false;
  }
}
$('#bookForm').addEventListener('click', (e) => {
  const b = e.target.closest('.chips button');
  if (!b || b.disabled) return;
  const name = b.closest('.chips').dataset.name;
  setBooking({ [name]: name === 'place' ? b.dataset.v : Number(b.dataset.v) });
});
$('#f-name').addEventListener('change', () => setBooking());
setBooking();

// --- envoi de la demande
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
  const { what, price } = bookingSummary();
  const data = { ...Object.fromEntries(new FormData(form)), cours: what, prix: fmt(price) };
  const first = data.name.trim().split(/\s+/)[0];
  let sent = false;
  if (CONFIG.formEndpoint) {
    try {
      const r = await fetch(CONFIG.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
      sent = r.ok;
    } catch { sent = false; }
  }
  const sendErr = $('#e-send');
  if (CONFIG.formEndpoint && !sent) {
    sendErr.textContent = CONFIG.whatsapp
      ? 'Le message n\'est pas parti. Vérifiez votre connexion et réessayez, ou écrivez-moi sur WhatsApp.'
      : 'Le message n\'est pas parti. Vérifiez votre connexion et réessayez.';
    sendErr.hidden = false;
    return;
  }
  sendErr.hidden = true;
  form.hidden = true;
  const done = $('#formDone');
  done.hidden = false;
  $('#formDoneText').textContent = `Merci ${first}, j'ai bien reçu votre demande (${what.toLowerCase()}). Je vous recontacte très vite pour fixer le jour et l'heure.`
    + (CONFIG.formEndpoint ? '' : ' Démo : le formulaire n\'est pas encore relié, rien n\'a été envoyé.');
  done.focus();
  Sound.splash?.();
});
['#f-name', '#f-contact', '#f-ok'].forEach((s) => $(s).addEventListener('input', (e) => {
  if (e.target.getAttribute('aria-invalid') === 'true') { e.target.setAttribute('aria-invalid', 'false'); $(`#e-${s.slice(3)}`).hidden = true; }
}));

// --- menu
const menu = $('#menu');
const menuBtn = $('#menuBtn');
$('#menuList').innerHTML = STATIONS.map((s, i) => `<li style="animation-delay:${i * 30}ms"><button type="button" data-menu="${i}"><span>${i + 1}</span>${s.title || s.label}</button></li>`).join('');
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
  closeMenu();
  if (html.classList.contains('classic')) to3D(); else toClassic();
});
function toClassic() {
  app?.destroy?.();
  app = null;
  html.classList.add('classic');
  classicBtn.textContent = 'Version 3D';
  initClassic();
  scrollTo(0, 0);
}
function to3D() {
  if (!webglOK()) return;
  html.classList.remove('classic');
  classicBtn.textContent = 'Version simple, sans 3D';
  const old = $('#scene');
  old.replaceWith(old.cloneNode(false)); // contexte WebGL neuf
  boot3D();
}
// liens « à compléter » : ne pas sauter en haut de page
document.addEventListener('click', (e) => { if (e.target.closest('a[href="#"]')) e.preventDefault(); });

/* ==================================================================
   Son (désactivé par défaut, synthétisé : aucun fichier audio)
================================================================== */
const Sound = (() => {
  let ctx, master, lp, on = false;
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
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
  function setUnderwater(u) {
    if (!ctx || !lp) return;
    lp.frequency.setTargetAtTime(u ? 180 : 520, ctx.currentTime, 0.15);
  }
  return { toggle, bloop, splash, setUnderwater };
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
  boot3D();
}

function boot3D() {
  import('./scene-app.js')
    .then((m) => { app = m.start({ STATIONS, SUBPINS, EASTER, Sound, selectTab, closeMenu, openMenu, isMenuOpen: () => menuOpen, toClassic }); })
    .catch((err) => {
      console.error(err);
      toClassic();
    });
}

let classicReady = false;
function initClassic() {
  $('#loader')?.classList.add('is-done');
  if (classicReady) return;
  classicReady = true;
  document.addEventListener('click', (e) => {
    if (!html.classList.contains('classic')) return;
    const a = e.target.closest('[data-go]');
    if (a) {
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && html.classList.contains('classic')) closeMenu(); });
}

