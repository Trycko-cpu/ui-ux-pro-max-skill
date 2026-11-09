# MyLizaSwim : le bassin

Site vitrine immersif pour MyLizaSwim, coach de natation (Aquababy, enfants, jeunes et adultes).

## Le concept

On arrive **face à un bassin de 3 couloirs**, dans un diorama 3D lumineux. Chaque objet du bassin est une porte vers une information :

| # | Objet dans le bassin | Ouvre |
|---|---|---|
| 1 | Les 3 bouées qui flottent | **Ma méthode** (Sensation · Expression · Application) |
| 2 | La chaise de maître-nageur + parasol | **Votre coach** |
| 3 | Les 3 plots de départ numérotés | **Quel nageur êtes-vous ?** (1 couloir = 1 profil) |
| 4 | L'échelle + la planche | **Le premier cours** |
| 5 | Le banc et ses piles de serviettes (1, 2, 3 = unité, carnet 5, carnet 10) | **Tarifs** (grille guidée) |
| 6 | Le tableau d'affichage (heure en direct) | **Avis** |
| 7 | La bouée de sauvetage | **FAQ** |
| 8 | Vue du ciel sur le bassin | **Réserver** |

- **Pas besoin de défiler** : tout est cliquable depuis la vue d'ensemble (objets 3D, pastilles, menu, ligne d'eau à droite).
- **Au défilement**, la caméra glisse sur un rail continu entre les objets, avec un aimant doux sur chaque étape (une molette = une étape ; un trackpad permet de « scrubber »).
- **Le dauphin en verre** (mascotte) nage d'étape en étape en sautant, et explique chaque fonction en français. Cliquez dessus : il fait une pirouette.
- **Intro** (1re visite seulement) : le bassin se remplit, puis le dauphin plonge.

## Lancer en local

Les modules ES exigent un serveur (l'ouverture directe du fichier ne marche pas) :

```bash
cd projects/mylizaswim
python3 -m http.server 8000
# puis http://localhost:8000
```

Aucune dépendance à installer, aucune étape de build : three.js et les polices sont auto-hébergés dans `vendor/` et `assets/fonts/` (pas d'appel à Google Fonts, pas de CDN, ce qui évite le souci RGPD).

URL utiles :

- `?brouillon` : surligne en orange **tout ce qui reste à fournir** par la cliente.
- `?classique` : version sans 3D (aussi utilisée automatiquement sans WebGL ou sans JavaScript).
- `#tarifs`, `#coach`… : lien direct vers un panneau (partageable).

## À fournir avant la mise en ligne

Visible avec `?brouillon` :

- [ ] **Photo de la coach** (portrait, 1200 × 1500 px min.)
- [ ] **Nom complet** et **diplômes** (BPJEPS AAN / BNSSA / formation bébés nageurs… : rassure les parents)
- [ ] **Vraie grille tarifaire** : `assets/js/app.js` → `PRICING` (les prix actuels sont **indicatifs**)
- [ ] **Durées des séances** par profil (`PRICING.who[].duration`)
- [ ] **Vrais avis** clients (avec leur accord). Les 3 avis affichés sont des **exemples** étiquetés comme tels.
- [ ] **Lieu(x)**, jours, créneaux, conditions d'annulation (FAQ)
- [ ] **Téléphone, Instagram**, lien fiche Google
- [ ] **Brancher le formulaire** : `assets/js/app.js` → `CONFIG.formEndpoint` (Formspree, Basin…). Sans ça, le formulaire affiche « Démo : formulaire pas encore connecté. »
- [ ] Mentions légales + politique de confidentialité
- [ ] Logo vectoriel d'origine (le logo actuel a été vectorisé depuis une image : correct à l'écran, à remplacer par le fichier source)

## Structure

```
index.html              tout le contenu (SEO, lecteurs d'écran, mode classique)
assets/css/style.css    design system : tokens, panneaux, responsive, mode classique
assets/js/app.js        contenu dynamique : étapes, tarifs, formulaire, menu, son
assets/js/scene-app.js  expérience 3D : caméra, défilement, pastilles, dauphin, intro
assets/js/world.js      le bassin en three.js (100 % procédural, aucun modèle 3D)
assets/img/             logo vectorisé (SVG)
assets/fonts/           Jost (variable) + Instrument Serif, licence OFL
vendor/three/           three.js r169 (MIT)
```

Les positions caméra de chaque étape sont dans `STATIONS` (`app.js`), avec une variante mobile (`camM` / `lookM`).

## Choix de design

- **Couleurs** : bleu marque `#2F39DA`, orange marque `#D4713D`. L'orange marque n'atteint pas le contraste AA avec du texte blanc (3,4:1), donc les boutons utilisent `#BC5A28` (4,6:1) et le texte orange `#B4531F`.
- **Typographie** : Jost (héritière libre de Futura, cousine du « S W I M » du logo) + Instrument Serif en italique pour les mots qui portent l'émotion (« libre », « à l'eau »).
- **Accessibilité** : navigation complète au clavier (flèches, Échap, Tab), `prefers-reduced-motion` respecté (pas d'intro, coupes franches), pastilles et ligne d'eau en vrais boutons, version sans 3D en un clic.
- **Performance** : ~280 Ko transférés en gzip (940 Ko bruts, dont three.js), aucune image lourde, rendu limité à 1,5× la densité d'écran sur mobile, ombres allégées, boucle en pause quand l'onglet est caché.
