# MyLizaSwim : le bassin

Site vitrine immersif pour MyLizaSwim : Emmy, coach de natation à Bruxelles (Aquababy, enfants, jeunes et adultes).

## Le concept

Une visite en trois lieux, guidée par un dauphin de verre :

1. **Le salon d'accueil** (bois, cuir cognac, velours marine, cheminée) : on arrive, on s'installe, on aperçoit le bassin à travers la verrière.
2. **La piscine intérieure** (pierre, colonnes sombres, rubans LED chauds, alcôves avec transats) : chaque objet est une porte vers une information.
3. **La terrasse** (dalles claires, fauteuils tressés, arbres, ciel bleu → orange) : fin de la visite, on prend contact.

| # | Où | Objet | Ouvre |
|---|---|---|---|
| 0 | Salon | vue sur la verrière | Accueil |
| 1 | Piscine | 3 lanternes flottantes | **Ma méthode** (Sensation · Expression · Application) |
| 2 | Piscine | chaise de maître-nageur | **Votre coach** |
| 3 | Piscine | 3 plots numérotés | **Quel nageur êtes-vous ?** (1 couloir = 1 profil) |
| 4 | **Sous l'eau** | échelle, planche vue d'en dessous | **Le premier cours** |
| 5 | Piscine | banc et piles de serviettes (1, 5, 10) | **Tarifs** (grille guidée) |
| 6 | Piscine | écran à gauche de la sortie | **Avis** |
| 7 | Piscine | bouée à droite de la sortie | **FAQ** |
| 8 | Terrasse | tables et fauteuils | **Prendre contact** |

- **Pas besoin de défiler** : objets cliquables, pastilles, menu, ligne d'eau à droite.
- **Au défilement**, la caméra glisse sur un rail continu, du salon à la piscine, plonge sous la surface à l'étape 4 (brouillard bleu, rayons de lumière, bulles, son étouffé si le son est activé), ressort, puis sort sur la terrasse.
- **Le dauphin** est modélisé en sections elliptiques (melon, rostre, nageoires falciformes) et nage avec une ondulation dorso-ventrale calculée dans le shader. Entre deux étapes, il plonge, nage sous la surface, puis saute à l'arrivée ; à l'étape 4, il tourne autour de la caméra sous l'eau. Cliquez dessus : il fait une vrille.

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
assets/js/world.js      salon, piscine, terrasse et dauphin en three.js (100 % procédural)
assets/img/             logo vectorisé (SVG)
assets/fonts/           Jost (variable) + Instrument Serif, licence OFL
vendor/three/           three.js r169 (MIT)
```

Les positions caméra de chaque étape sont dans `STATIONS` (`app.js`), avec une variante mobile (`camM` / `lookM`).

## Choix de design

- **Ambiance** : piscine au crépuscule. Fond en dégradé bleu marque → orange marque, lumière dorée rasante, bassin éclairé de l'intérieur, matières sobres (teck, toile écrue, marine, inox). La feuille de lecture reste claire pour le confort des textes longs.
- **Couleurs** : bleu marque `#2F39DA`, orange marque `#D4713D`. L'orange marque n'atteint pas le contraste AA avec du texte blanc (3,4:1), donc les boutons utilisent `#BC5A28` (4,6:1) et le texte orange `#B4531F`.
- **Typographie** : Jost (héritière libre de Futura, cousine du « S W I M » du logo) + Instrument Serif en italique pour les mots qui portent l'émotion (« libre », « à l'eau »).
- **Accessibilité** : navigation complète au clavier (flèches, Échap, Tab), `prefers-reduced-motion` respecté (pas d'intro, coupes franches), pastilles et ligne d'eau en vrais boutons, version sans 3D en un clic.
- **Performance** : ~280 Ko transférés en gzip (940 Ko bruts, dont three.js), aucune image lourde, rendu limité à 1,5× la densité d'écran sur mobile, ombres allégées, boucle en pause quand l'onglet est caché.
