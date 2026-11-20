# MyLizaSwim : le bassin

Site vitrine immersif pour MyLizaSwim : Maliza Grace-Emmy (« Emmy »), maître-nageuse à Bruxelles. Cours particuliers pour bébés nageurs, enfants, ados et adultes, seul, à deux ou à trois, à la piscine ou chez vous.

## Le concept

Une visite en trois lieux, guidée par un dauphin de verre. Ambiance tamisée : bois et pierre bruns, lumière ambrée qui balaie les murs, accents bleu Majorelle (bassin, fauteuils, gorges lumineuses) et orange (LED, lanternes, couchant), ombres longues du soleil qui n'entre que par la porte de la terrasse.

1. **Le salon d'accueil** (parquet, cuir cognac, velours bleu Majorelle, cheminée) : on arrive, on aperçoit le bassin à travers la verrière.
2. **La piscine intérieure** (pierre, colonnes sombres, rubans LED, alcôves avec transats), cadrée dans l'axe à l'entrée, comme une photo d'architecte.
3. **La terrasse** (dalles, pergola, fauteuils tressés, couchant) : fin de la visite, on prend contact.

| # | Où | Objet | Fiche |
|---|---|---|---|
| 1 | Salon | vue sur la verrière | Accueil |
| 2 | Piscine, vue axiale | 3 lanternes flottantes | **Ma méthode** (Sensation · Expression · Application) |
| 3 | Piscine | chaise de maître-nageur | **Votre coach** (photo, chiffres clés) |
| 4 | Piscine | 3 plots numérotés | **Pour qui ?** (1 couloir = 1 public) |
| 5 | **Sous l'eau** | échelle, planche vue d'en dessous | **Le premier cours** |
| 6 | Piscine | banc et piles de 1, 2, 3 serviettes | **Tarifs** (solo, duo, trio ; 30 minutes ou 1 heure ; encart « chez vous ») |
| 7 | Piscine | écran à gauche de la sortie | **Avis** |
| 8 | Piscine | bouée à droite de la sortie | **FAQ** |
| 9 | Terrasse | tables et fauteuils | **Réserver** (cours en trois choix, prix en direct) |

- **Pas besoin de défiler** : objets cliquables, pastilles, menu, progression à droite (barre d'étapes sur mobile).
- **Au défilement**, la caméra glisse sur un rail continu, une étape par geste, plonge sous la surface à l'étape 5, ressort, puis sort sur la terrasse.
- **Les textes** : Emmy parle à la première personne dans les fiches ; le dauphin dit simplement ce qu'on trouve à chaque étape. Phrases courtes, sans slogan ni jargon, et chaque bouton dit ce qu'il fait (« Voir les tarifs », « Envoyer ma demande »). « Aquababy » est devenu « Bébés nageurs », plus clair pour les parents.
- **Une fiche = une idée** : un titre court, une phrase, puis l'essentiel en tuiles. La fiche s'adapte à la hauteur de son contenu. Les fiches alternent bleu Majorelle et terre cuite (méthode bleue, coach orange, pour qui bleue…).
- **Le dauphin** nage avec une ondulation calculée dans le shader : il plonge entre deux étapes, saute à l'arrivée, tourne autour de la caméra sous l'eau. Cliquez dessus : il fait une vrille.

## Lancer en local

Les modules ES exigent un serveur (l'ouverture directe du fichier ne marche pas) :

```bash
cd projects/mylizaswim
python3 -m http.server 8000
# puis http://localhost:8000
```

Aucune dépendance à installer, aucune étape de build : three.js et la police sont auto-hébergés dans `vendor/` et `assets/fonts/` (aucun CDN, aucun appel à Google Fonts).

URL utiles :

- `?brouillon` : surligne ce qui reste à fournir.
- `?classique` : version sans 3D (aussi utilisée automatiquement sans WebGL, sans JavaScript, si le contexte 3D est perdu ou si le chargement bloque).
- `#tarifs`, `#coach`… : lien direct vers une fiche.

## Contenus

Les textes, tarifs, avis, FAQ et la photo d'Emmy viennent de l'ancienne version du site « Myliza Swim ». La photo de profil est celle fournie par Emmy en novembre 2026, recadrée en 4:3 (1200 × 900 px).

## À fournir avant la mise en ligne

- [ ] **Brancher le formulaire** : `assets/js/app.js` → `CONFIG.formEndpoint` (Formspree, Basin…). Sans ça, il affiche « Démo : le formulaire n'est pas encore relié » et n'envoie rien. Si l'envoi échoue, la demande reste à l'écran avec un message d'erreur.
- [ ] **Numéro WhatsApp** d'Emmy : `CONFIG.whatsapp` (affiche le lien « Ou écrire directement sur WhatsApp » avec la demande déjà rédigée).
- [ ] **Confirmer les tarifs** (`PRICES`, `DEPOSIT`) : forfait trio 10 × 30 min à 496 € (495 € suivrait la règle des -10 % des autres forfaits) ; acompte lu comme « 50 % du prix, sauf duo à la piscine : 20 € » ; cours chez vous = mêmes prix que l'heure, 1 h uniquement, chez les clients qui ont une piscine ; déplacement hors Bruxelles 10 € par km (aller simple ? à chaque cours, forfait compris ?)
- [ ] **Confirmer que les avis sont réels** et que les familles sont d'accord pour être citées.
- [ ] **Photos d'Emmy avec les enfants** pour le bandeau de la fiche Avis (`PHOTOS` dans `assets/js/app.js`) : visages des enfants floutés avant publication, et accord écrit des parents.
- [ ] Mentions légales + politique de confidentialité.
- [ ] Logo vectoriel d'origine (l'actuel a été vectorisé depuis une image).

## Structure

```
index.html              tout le contenu (SEO, lecteurs d'écran, mode classique)
assets/css/style.css    design system : tokens, fiches, responsive, mode classique
assets/js/app.js        contenu : étapes, tarifs, réservation, menu, son
assets/js/scene-app.js  expérience 3D : caméra, défilement, pastilles, dauphin, garde-fous
assets/js/world.js      salon, piscine, terrasse et dauphin en three.js (100 % procédural)
assets/img/             logo vectorisé (SVG), photo d'Emmy
assets/fonts/           Inter (variable), licence OFL
assets/models/          dauphin modélisé dans Blender (binaire compact)
assets/bake/            lumière cuite dans Blender : atlas WebP + UV de lumière (bake.json, bake.bin)
blender/                scripts Blender (dauphin, cuisson de la lumière, eau) et export de la scène
vendor/three/           three.js r169 (MIT)
```

Les positions caméra de chaque étape sont dans `STATIONS` (`app.js`), avec une variante mobile (`camM` / `lookM`) et une focale propre si besoin (`fov` / `fovM`).

## Blender : dauphin, lumière, eau

Trois éléments sont fabriqués dans Blender 5.3, utilisé comme module Python (`pip install bpy`, aucune interface) :

- **Le dauphin** (`blender/dolphin.py` → `assets/models/dolphin.bin`) : corps et nageoires fusionnés en une seule peau (remaillage voxel, lissage, décimation à 24 000 triangles). Le verre ne montre plus de jointures. La version procédurale reste en secours.
- **La lumière** (`blender/bake.py` → `assets/bake/`) : la scène fixe est exportée depuis three.js, reconstruite dans Blender avec de vraies sources (spots, soleil couchant, LED, écrans, guirlande). Les fausses taches de lumière deviennent de vrais projecteurs. Cycles calcule l'éclairage direct et indirect, les ombres douces et les rebonds colorés, puis l'image est débruitée (Intel Open Image Denoise, fourni avec Blender) et encodée en WebP. Dans le navigateur, ces cartes remplacent l'éclairage diffus temps réel ; les reflets restent en temps réel.
- **L'eau** (`blender/water.py` → `assets/img/water-normal.webp`) : vaguelettes tirées de la simulation d'océan de Blender (carte qui se répète sans couture). Les reflets viennent d'une capture du hall faite une fois au chargement, recalée sur les murs (projection de boîte).

Relancer la cuisson après une modification du décor (`world.js`) :

```bash
pip install bpy playwright            # bpy 5.3 exige Python 3.13
cd projects/mylizaswim && python3 -m http.server 8765 &
node blender/export-scene.cjs http://localhost:8765/ /tmp/bake-src
python blender/bake.py -- /tmp/bake-src /tmp/bake-out bake 20 2048   # échantillons, taille du hall
python3 blender/encode.py /tmp/bake-out assets/bake
```

La scène est construite avec un hasard reproductible : les cartes retombent exactement sur les mêmes surfaces. Si une surface change (taille, position, couleur), elle repasse simplement en éclairage temps réel jusqu'à la prochaine cuisson.

## Choix de design

- **Typographie** : la police système d'Apple (SF Pro) sur Mac, iPhone et iPad, Inter ailleurs. Titres courts, graisse 600, interlettrage serré ; pas d'italique décoratif, pas de capitales espacées.
- **Couleurs** : bleu Majorelle `#2F39DA`, orange `#D4713D`, brun expresso pour le verre de l'interface. L'orange marque n'atteint pas le contraste AA avec du texte blanc (3,4:1), donc les boutons utilisent `#BC5A28` (4,6:1). Pour la même raison, les fiches orange partent d'un orange terre cuite (`#B5541F` → `#8C3B15`) : le texte blanc y reste lisible en AA.
- **Fiches** : papier blanc, gris neutres façon Apple (`#1D1D1F`, `#6E6E73`, tuiles `#F5F5F7`).
- **Repères** : numéro et titre de l'étape dans la carte du guide, bouton explicite par étape, un geste de défilement = une étape au plus.
- **Garde-fous** : qualité adaptative si l'appareil rame, proposition (une seule fois) de la version sans 3D, bascule automatique si la 3D plante.
- **Accessibilité** : navigation complète au clavier (flèches, Échap, Tab), `prefers-reduced-motion` respecté, pastilles et progression en vrais boutons.
