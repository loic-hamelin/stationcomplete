# StationComplete — Spécification UX du MVP

> Document de travail pour produire les maquettes visuelles. Version 0.3 — 2026-11-05 (maquettes validées par Loïc, avec pancartes nV et US/UM et dessin de quai en polygone).
> À valider par Loïc avant tout développement.
> v0.2 : décisions de Loïc intégrées (§ 0 bis) et champs alignés sur `osm-tags-rapport.md` (§ 3 E6, E7, E11, § 4).

## Refonte visuelle v1 (6 novembre 2026)

Habillage revu (palette, police, carte, icônes, contrôles) sans changer les parcours ni les contenus. Valeurs à jour au § 5 ; jetons dans `src/app.css`, style de carte dans `src/lib/map/style.ts`.

Décisions de Loïc :

1. **Police** : Atkinson Hyperlegible **Next**, graisses 400 et 600 seulement (woff2, sous-ensembles latin et latin-ext, ce dernier chargé à la demande). L'ancienne police (400/700) est retirée.
2. **Bleu d'action** : bleu OSRD exact `#1844EF` en clair ; `#8098F6` (teinte claire du même bleu) en sombre. Ratios calculés par `scripts/contrast.mjs` (§ 5.1).
3. **Numéros de voie complets** masqués sur la vue générale (zoom < 18, sauf voie à compléter, en alerte, modifiée ou sélectionnée), visibles en zoomant.
4. **« Modifié par vous »** : trait bleu pâle `#B3C8FF` + point bleu dans l'étiquette.
5. **Feuille basse E5** : un seul bouton « Renseigner », compact (à filet, non pleine largeur), qui mène à la fiche ; titre, 1 à 3 constats avec icône, lien « Voir sur OpenStreetMap » (et lien discret « Pancarte ici » pour une voie).
6. **E5, E6, E11 : menus flottants** au-dessus d'une carte plein écran (cartes à coins arrondis, ombre légère, marges 8 px, zones sûres respectées). Les flèches de 20 cm ne sont plus affichées en permanence : un petit bouton « Ajuster au centimètre » ouvre un pavé flottant (alternative sans glisser, WCAG 2.5.7) ; libellés des flèches inchangés.

Écarts assumés avec cette spécification (v0.3) :

| Sujet               | v0.3                              | Refonte v1                                                                                                                                                                                                             | Raison                                                     |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Tailles de libellés | Légende 14 sp minimum             | 13 px pour surtitres en capitales et onglets ; 11 px pour les étiquettes de carte (codes de 1 à 5 caractères)                                                                                                          | Allègement ; libellés courts uniquement                    |
| Cibles              | ≥ 48 × 48 dp partout              | 48 px pour actions principales et lignes ; 44 px pour boutons flottants, puces, zoom, segments ; 24 px pour les étiquettes de carte (WCAG 2.5.8), l'objet restant touchable sur son trait et présent dans la vue Liste | Contrôles plus discrets sur la carte                       |
| Réticule            | Croix jaune `#FFD400` à halo noir | Croix blanche 1,5 px à liseré sombre, centre libre de 16 px ; jaune `#FFF700` quand le point est accroché                                                                                                              | Précision au mètre ; l'accrochage se voit sur la croix     |
| Tracés sur l'ortho  | Halo blanc/noir de 2 px           | Trait clair + liseré sombre (0,75 px de chaque côté), épaisseurs selon le zoom                                                                                                                                         | Moins lourd, ≥ 3:1 sur béton comme sur ballast             |
| Icônes              | Material Symbols ou Lucide        | Jeu maison de 37 icônes, trait 1,5 px (`src/lib/icons.ts`)                                                                                                                                                             | Poids, cohérence du trait fin, aucune dépendance           |
| États des marqueurs | ✓ ? ! ⏱ en coin                   | « ! » dans une pastille rouge (alerte), « ? » ambre (à compléter), point bleu (modifié), rien si complet                                                                                                               | Moins de signes ; forme + couleur, jamais la couleur seule |
| Alerte sur E4       | Carte encadrée de rouge           | Icône rouge dans un carré teinté, en tête de liste                                                                                                                                                                     | Couleur d'alerte réservée au signe                         |
| Thème               | Système seulement                 | Réglage Système / Clair / Sombre dans E10 (`data-theme`)                                                                                                                                                               | Prévu par la maquette E10                                  |

Non repris pour l'instant : mode « Plein soleil », mini-carte en tête de E7, « ancien → nouveau » barré sur E8 (le résumé reste celui du cœur métier).

## Lot 7 — Modifier un quai existant (6 novembre 2026)

Demande de Loïc : « pouvoir éditer les quais déjà présents ». Trois actions, toutes depuis la feuille basse d'un quai sur E5 :

1. **Modifier la forme** (quai en surface) : déplacer, ajouter, retirer des sommets — nouvel écran **E12**.
2. **Redessiner en surface** (quai tracé en ligne) : même écran, contour neuf autour de l'ancienne ligne affichée en trait pâle (en pointillés avant le lot 7d).
3. **Supprimer ce quai** : confirmation dans la feuille, motif obligatoire.

**Suite (retour de Loïc sur la vraie carte)** : les quais réels partagent presque tous leurs points (bord de quai, toit, bâtiment, intérieurs). E12 explique désormais chaque verrou en clair, rend déplaçables les points partagés seulement avec le bord du quai (le bord suit), sélectionne et insère à la croix (« Prendre ce point », « Ajouter un point ici ») et ne pose plus de cibles qui se recouvrent.

**Lot 7c (retour de Loïc, Marolles-en-Hurepoix, « Quai voies 2b » : 22 points sur 24 partagés avec le contour de la gare)** : décision du porteur — « ma modification sur le quai doit entraîner la modification des autres objets pour avoir un tout cohérent ». Un point partagé avec **n'importe quel** autre objet se déplace désormais ; c'est le même nœud OSM, les objets qui le partagent suivent, et l'appli le dit avant, sans bloquer. E12 reprend aussi exactement la vue (centre, zoom) de E5 et la lui rend ; sélectionner un point ne change plus le zoom ; les menus flottants passent toujours au-dessus des repères de la carte.

**Lot 7d (retours de Loïc, 7 novembre 2026)** — trois demandes validées :

1. **Supprimer aussi une pancarte d'arrêt existante**, même parcours que pour un quai : menu ⋮ de la fiche E5, motif obligatoire (« En double » ou « Mal placée » à distance, « N'existe plus » sur place seulement), confirmation dans la feuille, récapitulatif en clair. La pancarte est un nœud de la voie : il est retiré de la voie puis supprimé seulement si c'est sans risque, sinon il reste et seuls ses tags partent (la forme de la voie ne change jamais) ; l'appli le dit avant de confirmer. Les voies ne se suppriment jamais ; une pancarte ajoutée dans l'appli et pas encore envoyée se retire dans « Mes contributions » (pas de doublon).
2. **Pointillés = souterrain.** Loïc a lu les pointillés « à compléter » comme des objets souterrains (convention cartographique). Les pointillés, un peu estompés, sont désormais réservés aux quais et voies souterrains (tunnel, couche ou niveau négatif, `location=underground`) sur E5, E6, E11 et E12. « À compléter » ne se lit plus que sur l'étiquette (« ? », « ! »), trait plein. Une **légende** sobre s'ouvre par un petit bouton « i » sur E5.
3. **Accrochage et réticule (E11, E12).** Retour : « Le point jaune snape loin de la croix. C'est particulièrement vrai quand le quai est étroit. » Le point placé est désormais **exactement sous la croix** ; l'accrochage au bord de la voie ne s'applique que si le point accroché est à moins de **12 px** de la croix à l'écran (en plus de la limite de 4 m de l'axe) : en zoomant, on n'est plus happé. Accroché, la croix devient jaune et un petit trait la relie au point ; sinon, aucun point jaune séparé. Interrupteur discret « Accrocher à la voie » (activé par défaut, mémorisé). Un sommet modifiable se **glisse au doigt** (la croix reste l'alternative sans glisser). Au passage, le pas du pavé « Ajuster au centimètre » (E6, E11, E12) est corrigé : il faisait 10 cm au lieu des 20 cm annoncés.

**Lot 7d, ajout (bug constaté par Loïc à Marolles-en-Hurepoix, changeset 191589972)** : après une modification de forme du « Quai voies 2b », la voie 2 avait disparu de la carte (la carte ne dessinait que les voies qui longent un quai, et la nouvelle forme ne la longeait plus). Désormais :

4. **Toutes les voies ferrées de la gare sont dessinées** sur E5 ; celles qui ne longent aucun quai sont plus discrètes (trait plus transparent), sans quête ni « ? », avec une étiquette seulement si elles portent un numéro, et une fiche simple (« Voie 2 — Ne longe aucun quai cartographié », lien OpenStreetMap). Le compteur « Voies x/y » du tableau de bord reste celui des voies le long des quais (règle des quêtes).
5. **Avertissement avant d'enregistrer (E11, E12)** : si une voie que le quai longeait ne le longe plus avec la nouvelle forme (même règle que les quêtes), le panneau l'écrit, sans bloquer : « Le quai ne longe plus la voie 2 (bord à 9 m). Vérifiez la forme : le bord du quai doit suivre la voie. », avec « Corriger » (reste sur l'écran) et « Enregistrer quand même ».

**Quai en plusieurs parties (11 novembre 2026, retour de Loïc à Paris-Saint-Lazare)** : un même quai est découpé dans OSM en 2 ou 3 polygones (partie à l'air libre, parties couvertes par la dalle de la place de l'Europe, `layer=-1`), comme les voies coupées en tunnel ; l'appli montrait plusieurs « ? » et comptait le quai deux ou trois fois. Décisions validées :

1. **Quai logique** : l'appli regroupe automatiquement les parties d'un même quai (elles se touchent, sont dans le prolongement l'une de l'autre et longent les mêmes voies, du même côté) ; jamais deux quais de part et d'autre d'une voie, ni des quais côte à côte. **On ne fusionne pas dans OSM** (pratique OSM, comme les voies coupées aux tunnels). Règles et seuils : architecture § 4.4.8.
2. **Quêtes et jauges** : un quai en plusieurs parties compte pour **un** quai (E3, E4, index hebdomadaire) ; voies et pancartes sont celles du quai entier.
3. **Carte** : une seule étiquette, sur la partie principale (à l'air libre de préférence) ; parties couvertes en pointillés estompés ; toucher n'importe quelle partie sélectionne le quai entier (toutes ses parties en jaune). Forme et suppression restent par partie.
4. **Numéros cohérents** : un numéro saisi s'écrit sur toutes les parties, dans le même envoi ; parties aux numéros différents → quai signalé « à vérifier » (sans correction automatique).

Forme et suppression « en double » sont permises **à distance** (photo aérienne), comme le dessin E11. Le motif « N'existe plus » exige d'être sur place (`canSurvey`). Les numéros restent saisis par « Renseigner » (E7), sur place. Règles OSM : architecture § 4.4.4.

---

## Lot « Équipements » — informations utiles aux voyageurs (11 novembre 2026)

Demande de Loïc, validée : compléter dans OSM des informations utiles aux voyageurs, avec des tags établis (rapport tags § 10). OSM ne garde que le durable : aucun état de panne n'est écrit. Tout se relève **sur place** (`canSurvey`), y compris l'abri (choix documenté au rapport § 10). `check_date` est posé à l'enregistrement sur place.

### Lot S1 — État officiel des ascenseurs et escaliers mécaniques (E4, 12 novembre 2026)

- **E4**, sous la liste des quêtes et la mention OSM, section discrète (filet en tête) **« Ascenseurs et escaliers mécaniques — état officiel »**, bouton « Actualiser l'état officiel » (icône). Résumé « 3 équipements · 1 hors service » ; liste : état en icône **et** texte (✓ En service, ✕ Hors service, ? Statut inconnu ; hors service d'abord), libellé et localisation **tels que publiés** ; « Lu le 12/11/2026 14:05. L'exploitant met cet état à jour toutes les heures. » ; « Source : SNCF Gares & Connexions (ODbL). Information non contractuelle, affichée telle que publiée par l'exploitant. »
- **« Signaler une panne »** (repliable) : « stationcomplete ne transmet rien à l'exploitant… », lien vers le site Gares & Connexions (chercher la gare), formulaire de contact, Assist'enGare (handicap, mobilité réduite) tous les jours de 8 h à 20 h, **3212** et +33 9 72 72 00 92 en texte sélectionnable.
- États : gare non couverte ou coupure par `config.json` → rien ; source injoignable → « État officiel indisponible pour le moment. » ; hors connexion (≤ 3 h) → bandeau « Hors connexion : état lu le …, peut-être dépassé. ». Rien sur la carte (pas de position).

### Étape 1 — Caractéristiques des quais

- **E7, fiche d'un quai** : sous les numéros, une section **« Équipements du quai »** (filet en tête, icône banc, consigne « Ce qui existe sur ce quai, vu sur place. « Je ne sais pas » ne change rien. »). Une question par groupe (`fieldset` + `legend`) :
  - **Hauteur du quai au-dessus du rail** : puces des hauteurs usuelles du pays (France : 0,55 m, 0,76 m, 0,92 m ; Suisse : 0,55 m), « Autre » (champ en mètres, « 0,38 » ; « 55 » ou « 55 cm » lus 0,55 m) et « Je ne sais pas ». Contrôle à l'enregistrement : « Hauteur illisible : indiquez des mètres, par exemple 0,55. » ; « Hauteur peu probable pour un quai : entre 0,10 et 1,50 m. » (`role=alert`).
  - **Écrans d'affichage des trains (horaires, voie)**, **Abri pour attendre**, **Bandes podotactiles le long du bord du quai**, **Bancs** : contrôle segmenté compact Oui / Non / Je ne sais pas.
  - Préremplissage avec ce qui est connu (tags du quai, bord de quai relié, abri ou banc cartographiés à part) ; sinon « Je ne sais pas » est choisi.
  - Quai en plusieurs parties : les réponses valent pour toutes les parties ; sous « Abri », la mention « Parties à l'air libre seulement : les parties couvertes ne sont pas concernées. ». Quai entièrement couvert : pas de question « Abri ».
- **Un seul « Enregistrer »** pour les numéros et les équipements : une seule saisie, un seul `<modify>` par partie. Sans numéro de voie, on peut enregistrer les équipements seuls ; sans rien du tout, le message habituel (« Indiquez au moins un numéro de voie le long du quai. »). Résumés : « Quai A : voies 1, 2 ; équipements : hauteur et abri », « Quai A : équipements (bancs) ». Commentaire du changeset : « … équipements des quais ».
- **Quête Q8 « Équipements à relever »** (sur place) : un quai dont une caractéristique manque. Priorité : après les numéros et les pancartes (Q1–Q5), avant les vérifications (Q6). **E4** : un groupe « 2 quais : équipements à relever », sous-titre « Hauteur, écrans et abri », icône banc, couleur « équipements » (`--equip`, 6,99:1 en clair, 9,37:1 en sombre). **E5** : constat « Équipements à relever : hauteur et abri » dans la feuille du quai ; l'étiquette du quai ne change pas (« ? » reste réservé au numéro).
- **E4, 4e jauge « Équipements »** : ligne compacte sous les trois tuiles (« Équipements 1/3 quais relevés » + barre segmentée). Elle **ne compte pas** dans les trois jauges existantes, ni dans l'état de la gare, ni dans l'index hebdomadaire (E3).

### Étape 2 — Ascenseurs et distributeurs de billets

- **E5** : nouveau filtre **« Équipements »** (puce ronde bleu ardoise) à côté de Quais · Voies · Pancartes ; légende « Équipement (ascenseur, distributeur) ». Sous le zoom 18 : petit rond bleu pâle ; au-delà : étiquette carrée blanche portant l'icône fine (ascenseur, billet), nommée « Ascenseur. Niveau -1, 0 · Accessible en fauteuil » pour le lecteur d'écran ; liseré jaune pâle si une précision manque. Un ascenseur cartographié en surface apparaît en son centre.
- **Feuille basse** : « Ascenseur » / « Niveau -1, 0 · Accessible en fauteuil » (ou « Aucune précision ») ; constat Q9 « Accès en fauteuil roulant à préciser » ; « Renseigner » ; ⋮ « Supprimer cet équipement… » (nœud isolé seulement, sinon « Équipement relié à d'autres objets (chemin, bâtiment, relation) ou dessiné en surface : à supprimer avec un éditeur comme iD ou JOSM. ») et « Voir sur OpenStreetMap ». Confirmation comme pour une pancarte : motifs « En double », « Mal placé » (à distance), « N'existe plus » (sur place), « Le point sera supprimé : il n'est relié à aucun autre objet. », saisies remplacées.
- **« + Ajouter »** devient un bouton à menu (`aria-expanded`) : « Que voulez-vous ajouter ? » → Pancarte d'arrêt (E6 comme avant), Ascenseur, Distributeur de billets.
- **Nouvel écran « Équipement »** (`/gare/equipement`, chargé à la demande) :
  - **« Où se trouve-t-il ? »** : « Dehors » → « Placer sur la photo aérienne » (E6 en placement libre : croix au centre, sans accrochage, « Le point sera posé sous la croix. ») ; « À l'intérieur ou sous terre » → placement **relatif au quai** (la photo et le GPS n'aident pas) : « Sur quel quai ? » (une ligne par quai : « Quai A — voies 1, 2 · 160 m »), « Où, le long du quai ? » (« Bout côté ouest », « Milieu », « Bout côté est », « À une distance… » en mètres depuis le premier bout, bornée à la longueur), « De quel côté ? » (« Côté voie 2 », « Au milieu », « Côté voie 1 » ; sans numéro : « Côté nord »). Les bouts et les côtés sont nommés par leur cap, jamais « tête/queue » (ambigu selon le sens des trains). Constat : « Quai A : point à 8 m du bout côté ouest, dans le contour du quai. Niveau du quai : 0. ». Le point est calculé dans le contour (à 1 m du bord pour un côté, au milieu sinon ; à 8 m d'un bout) ; quai tracé en ligne : sur la ligne.
  - **Attributs** : « Niveaux desservis » (ascenseur) ou « Niveau » (distributeur), facultatif, prérempli avec le niveau du quai ; « Accessible en fauteuil roulant » Oui / Non / Je ne sais pas (ascenseur) ; « Exploitant » facultatif (distributeur). Mention : le point est ajouté seul, non relié aux cheminements.
  - **Doublon** : à l'enregistrement, si un équipement du même type est à moins de 5 m : alerte « Ascenseur déjà cartographié à 2 m : est-ce le même ? » avec « Modifier celui-ci » et « En créer un autre ».
  - **Équipement existant** (`&osm=`) : mêmes attributs, « C'est correct » (`check_date`) et « Enregistrer » ; sur place seulement (bandeau cadenas comme E7).
- **Quête Q9** : ascenseur sans `wheelchair` (sur place). E4 : « 3 ascenseurs : accès en fauteuil à préciser ». Pas de jauge.
- **E8/E9** : ligne couleur « équipements », icône banc ; « Nouvel équipement », « Suppression d'équipement · motif : en double ». Commentaire du changeset : « ajouté : Ascenseur », « ascenseurs et distributeurs complétés », « Distributeur de billets supprimé (en double) ». `imagery_used` seulement si l'équipement a été placé sur la photo.

### Étape 3 — Escaliers et escaliers mécaniques existants

- **Compléter, pas dessiner** : les ways `highway=steps` (escalier), `highway=steps` + `conveying` (escalier mécanique) et `highway=footway` + `conveying` (tapis roulant) de la gare. Ni création, ni suppression, ni retournement.
- **E5** : sous le filtre « Équipements », trait fin bleu pâle sur liseré (estompé si souterrain), étiquette carrée à icône (escalier, escalier mécanique, tapis) posée au premier bout du trait, **flèche** au milieu quand le sens est connu (vers le haut, ou sens de marche). Légende : « Escalier (flèche vers le haut) ». Feuille : « Escalier » / « Flèche vers le haut · Niveau -1, 0 · 24 marches », constat Q10 « À compléter : sens de montée, mains courantes et bandes podotactiles » ou Q11 « Sens de marche à relever » ; « Renseigner » et « Voir sur OpenStreetMap » (pas de menu ⋮ : rien à supprimer).
- **Fiche « Escalier »** (`/gare/escalier`, chargée à la demande) : en tête, un **schéma** (SVG, nord en haut) du chemin en trait épais bleu avec une flèche **dans le sens du way**, et les quais voisins en vert pâle (`role=img`, description complète) ; légende « La flèche suit le sens du chemin dans OpenStreetMap. Vos réponses la suivent ; l'appli ne retourne jamais le chemin. ». Questions (Oui / Non / Je ne sais pas, ou puces) :
  - escalier mécanique, tapis : « Dans quel sens avance-t-il ? » — « Dans le sens de la flèche », « À contre-sens de la flèche », « Le sens change (selon l'heure) » ;
  - escalier, escalier mécanique : « Dans le sens de la flèche, l'escalier monte-t-il ou descend-il ? » — « ↑ Il monte », « ↓ Il descend » ;
  - escalier : « Mains courantes (en suivant la flèche) » — « Des deux côtés », « À gauche seulement », « À droite seulement », « Aucune » ; « Bandes podotactiles en haut et en bas » ; « Nombre de marches » (facultatif, contrôlé : « Nombre de marches illisible : un nombre entier de 1 à 500. »).
  - « C'est correct » (`check_date` seul) et « Enregistrer » (sur place) ; sans aucune réponse nouvelle : « Répondez à au moins une question, ou touchez « C'est correct ». ».
- **Quêtes** Q10 « 1 escalier à compléter » (sous-titre : ce qui manque) et Q11 « 1 escalier mécanique ou tapis : sens de marche à relever », sur place, après Q9, sans jauge. Commentaire du changeset : « escaliers complétés ».

---

## Mode souterrain (13 novembre 2026, validé par Loïc)

Problème : dans une gare souterraine, ni GPS ni réseau ; les saisies « sur place » y étaient impossibles. Solution :

- **Entrée** : « Je vais dans une gare souterraine » (icône escalier), sur **E4** sous « Emporter la gare hors-ligne », avec l'aide « Sous terre, ni GPS ni réseau. Vérifiez votre position à l'entrée, en surface : vous pourrez relever sur place pendant 2 heures dans cette gare, même hors-ligne. », et en version compacte dans les **fiches bloquées « à distance »** (bandeau cadenas de E7, de la fiche Équipement et de la fiche Escalier).
- **Parcours** : 1. la gare est téléchargée pour le hors-ligne si elle ne l'est pas (même téléchargement que « Emporter la gare hors-ligne », progression affichée) ; 2. la position est demandée une fois, **position du moment** (jamais une position gardée par le navigateur) ; 3. dans l'emprise : mode actif ; position **précise** mais hors de la gare : « Votre position est hors de la gare. Approchez-vous d'une entrée, en surface, puis réessayez. » (pas de déclaration : le GPS dit clairement autre chose) ; **pas de réponse** du GPS (refus, délai de 20 s, précision au-delà de 100 m) : déclaration sur l'honneur.
- **Déclaration sur l'honneur** : « Le GPS ne répond pas. Si vous êtes bien dans cette gare, vous pouvez le déclarer. », case « Je déclare sur l'honneur être dans la gare **X**. Je ne relève que ce que je vois, derrière la ligne de sécurité. », bouton « Activer le mode souterrain » (désactivé tant que la case n'est pas cochée) et « Réessayer ». Jamais de `confirm()` du navigateur.
- **Limites** : « sur place » vaut **2 heures**, pour **cette gare seulement**, même sans GPS ni réseau ensuite ; une autre gare reste « à distance » ; activer le mode dans une autre gare remplace le précédent. L'état est une préférence locale (`rc:underground` : serveur, gare, nom, heure d'expiration, manière) qui survit au rechargement et à l'absence de réseau.
- **Bandeau** : tant que le mode est actif, une bande sombre de 40 px en haut de **toutes** les pages (place réservée, rien n'est recouvert) : « **Mode souterrain** · Ambérieu-en-Bugey · encore 1 h 32 » et « Arrêter » (nom accessible « Arrêter le mode souterrain »). Seul le nom de la gare s'abrège si la place manque. Le temps restant se met à jour ; à l'expiration, le bandeau disparaît et les fiches se verrouillent de nouveau. Sur E4, la ligne devient « Mode souterrain actif pour cette gare jusqu'à 11:32. ».
- **Saisie** : chaque saisie garde, **sur le téléphone seulement**, la manière dont « sur place » a été établi (`gps`, `gps-entree`, `declaration`) ; rien de cela ne part dans OSM : les tags restent `source=survey` comme aujourd'hui. Une saisie faite sous déclaration fait cocher d'office « Je souhaite une relecture » sur E8 (QA-3).
- **Inchangé** : le mode démonstration et le serveur de test (la règle « sur place » ne s'y applique pas : le bouton n'y est pas proposé).
- **Hors-ligne** : une fois la gare téléchargée, tout le parcours fonctionne sans réseau (E4, carte et photo aérienne en cache, fiches, saisies, E8 « Envoyer dès le retour du réseau » qui part tout seul en surface) ; les pages sont servies par le service worker.

## 0 bis. Décisions validées (5 novembre 2026)

| Sujet            | Décision                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envoi            | Un changeset **par gare**, après relecture sur E8 (choix par défaut, Loïc sans préférence)                                                                                                                          |
| Pancartes        | **Position + type de pancarte (texte lu) + sens**. Les conditions détaillées (nombre de véhicules, longueur, US/UM) font partie du type et se saisissent dans la même grille                                        |
| À distance       | Autorisé pour **positions et vérifications** seulement. Les numéros de quais/voies et les pancartes exigent d'être **sur place** (GPS ponctuel dans l'emprise de la gare ; gare souterraine : mode souterrain, 2 h) |
| Gares sans quais | **Dessiner le quai** dans l'appli : nouvel écran E11                                                                                                                                                                |
| Motivation       | Compteurs personnels sobres, ni badges ni classement                                                                                                                                                                |
| Police           | **Atkinson Hyperlegible** (Marianne est réservée aux services de l'État) — remplacée par sa version **Next** à la refonte v1                                                                                        |
| Contributeurs    | Citoyens uniquement ; les employés de gare seront traités plus tard (organised editing)                                                                                                                             |

---

## 0. Principes directeurs (résumé)

| Principe           | Traduction concrète                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Une gare à la fois | Tout part de la gare choisie ; pas de carte « France entière » à explorer.                               |
| Quêtes simples     | Une question = un objet = un écran de saisie (inspiré de StreetComplete).                                |
| Précision au mètre | Le GPS centre la carte ; l'utilisateur place l'objet sur ortho IGN 20 cm, avec accrochage OSM.           |
| Sécurité d'abord   | Jamais d'incitation à s'approcher des voies. Saisie possible depuis le quai ou à distance.               |
| Sobriété           | 10 écrans, pas d'animation décorative, mode sombre, hors-ligne, GPS à la demande.                        |
| Accessible         | WCAG 2.2 AA, cibles ≥ 48 × 48 dp, actions principales dans la zone du pouce, alternative à tout glisser. |

Navigation globale : barre basse à 3 onglets — **Gare** · **Mes contributions** · **Réglages**. Un badge sur « Mes contributions » indique le nombre d'envois en attente.

---

## 1. Personas

### P1 — Julien, 34 ans, passionné de ferroviaire, contributeur OSM occasionnel

- Technicien de maintenance industrielle, prend le TER chaque jour (Lyon ↔ Ambérieu). Connaît la signalisation, lit les pancartes « 8 », « US/UM ».
- A déjà corrigé quelques rues dans OSM via iD, jamais de données ferroviaires.
- **Objectif** : documenter « ses » gares, voir sa gare passer à 100 %.
- **Contexte** : 5–10 min sur le quai en attendant son train, une main (l'autre tient un sac), souvent au soleil.
- **Frustrations** : les éditeurs OSM sont trop complexes sur mobile ; peur de « casser » les données.
- **Besoins UX** : quêtes courtes, reprise là où il s'est arrêté, retour visible de sa progression.

### P2 — Amina, 27 ans, voyageuse occasionnelle curieuse

- Chargée de communication, 1 trajet longue distance par mois. N'a jamais entendu parler d'OSM avant StationComplete.
- **Objectif** : « rendre service » pendant une attente, apprendre quelque chose.
- **Contexte** : gare inconnue, réseau mobile instable, batterie à 30 %.
- **Frustrations** : jargon (« ref », « changeset »), création de compte longue.
- **Besoins UX** : vocabulaire voyageur (« quai », « voie », « panneau d'arrêt »), aide illustrée, possibilité de tester sans compte, consommation batterie minimale.

### P3 — Bernard, 58 ans, contributeur OSM aguerri (mappeur ferroviaire)

- Retraité, 40 000 modifications OSM, connaît OpenRailwayMap et les tags `railway=*`.
- **Objectif** : compléter vite et proprement, depuis chez lui sur l'ortho, puis vérifier sur place.
- **Contexte** : tablette ou téléphone, sessions longues, à distance comme sur le terrain.
- **Frustrations** : outils qui masquent les tags ou écrasent des données existantes ; changesets mal commentés.
- **Besoins UX** : voir les tags bruts (option), contrôler le commentaire de changeset, gestion des conflits explicite, source renseignée.

---

## 2. Parcours utilisateurs principaux

Notation : `E#` renvoie aux écrans de la section 3.

### 2.1 Première ouverture + connexion OSM

1. **E1 Bienvenue** : étape « langue » (et pays des gares si plusieurs pays sont activés), puis 3 cartes défilables (À quoi ça sert · Sécurité · Vos données dans OSM). La carte Sécurité est obligatoire (bouton « J'ai compris » pour avancer).
2. **E2 Connexion** : « Se connecter avec OpenStreetMap » (OAuth2, navigateur système) ou « Créer un compte OSM » ou « Explorer sans compte ».
3. Retour d'OAuth → message « Connecté en tant que @pseudo » → **E3 Choisir une gare**.
4. _Variante sans compte_ : tout est possible sauf l'envoi ; les contributions restent dans la file locale ; l'invitation à se connecter apparaît sur E8.

Points d'attention : pas de permission GPS demandée à ce stade ; la demande apparaît seulement au premier appui sur « Gares autour de moi ».

### 2.2 Choisir une gare

1. **E3** : champ de recherche (nom, commune, code UIC) en haut + bouton « Gares autour de moi » (GPS ponctuel, coupé après obtention).
2. Résultats en liste (nom, commune, distance, mini-jauge de complétude). Gares récentes et favorites en tête si champ vide.
3. Appui → **E4 Tableau de bord gare**. La gare devient « gare active » (mémorisée).
4. Option « Télécharger pour hors-ligne » (taille estimée affichée) depuis E4.

### 2.3 Voir ce qui manque

1. **E4** affiche 3 jauges (Quais · Voies · Pancartes) et la liste des quêtes triées par priorité (voir §4).
2. Appui sur une quête → **E5 Carte de la gare** centrée sur l'objet concerné, ou directement **E7 Fiche objet** si la quête ne demande pas de position.
3. Bascule « Liste / Carte » sur E4 pour voir les objets manquants sur la carte (pastilles « ? »).

### 2.4 Ajouter un objet (ex. une pancarte d'arrêt)

1. Depuis E4 (quête « Positionner les pancartes du quai B ») ou depuis E5 (bouton « + Ajouter » → choix du type).
2. **E6 Placement fin** : réticule fixe, carte glissante sur ortho, accrochage au bord de quai, loupe, indicateur de précision. Boutons de micro-déplacement (alternative au glisser). « Valider la position ».
3. **E7 Fiche objet** : attributs (numéro/texte de la pancarte, type, côté, source). « Enregistrer ».
4. Confirmation discrète (bandeau 3 s : « Pancarte ajoutée — 1 envoi en attente ») + proposition « Suivante sur ce quai ».
5. Retour E5 ; la quête se met à jour.

### 2.5 Vérifier / corriger un objet existant

1. Quête « À vérifier » sur E4, ou appui sur un objet existant sur E5 → feuille basse de résumé.
2. **E7 en mode vérification** : valeurs actuelles affichées, deux gros boutons : « C'est correct » / « Corriger ».
3. « C'est correct » → enregistre une vérification (date de vérification, à aligner sur le rapport tags), sans modifier le reste.
4. « Corriger » → champs éditables ; « Déplacer » ouvre E6 avec l'objet préchargé ; « Signaler une suppression » (objet disparu) demande une confirmation et un motif.
5. Les valeurs modifiées sont surlignées (ancien → nouveau) avant enregistrement.

### 2.6 Envoyer / hors-ligne

1. Toute saisie est d'abord enregistrée **localement** (file d'attente), qu'il y ait du réseau ou non.
2. **E8 Envoi** : liste des modifications groupées par gare, commentaire de changeset prérempli et modifiable, source prérenseignée, bouton « Envoyer dans OpenStreetMap ».
3. Hors-ligne : bandeau persistant « Hors-ligne — 4 modifications seront envoyées au retour du réseau ». Envoi automatique au retour du réseau **si l'utilisateur l'a autorisé** (réglage, activé par défaut), sinon notification « Prêt à envoyer ».
4. Conflit (l'objet a changé dans OSM entre-temps) → l'élément passe en « À revoir » sur E8 avec comparaison « Votre version / Version OSM » et choix explicite.
5. Succès → lien vers le changeset sur osm.org, compteurs mis à jour.

### 2.7 Historique de mes contributions

1. **E9** : 3 sections — En attente · À revoir · Envoyées.
2. Chaque ligne : icône objet, gare, résumé (« Quai 3 : numéro ajouté »), date, statut.
3. Appui sur une ligne envoyée → lien changeset OSM ; sur une ligne en attente → modifier ou supprimer avant envoi.
4. En tête : compteurs simples (modifications envoyées, gares touchées).

---

## 3. Écrans du MVP (10)

Conventions des wireframes : largeur ~ 360 dp ; `[ Bouton ]` ; `( )` bouton rond ; `▓` zone carte ; `═══` barre d'onglets.

### E1 — Bienvenue & sécurité

- **Objectif** : expliquer en 30 s le but, la sécurité, l'usage des données.
- **Contenu** : 3 cartes (illustration simple + 2 phrases). Carte 2 = règles de sécurité (pictogramme ligne jaune).
- **Composants** : carrousel avec pagination, bouton principal bas, lien « Passer » (sauf carte sécurité).
- **Actions** : Suivant / J'ai compris / Passer.
- **États** : hors-ligne → aucun impact (contenu embarqué). Pas d'état vide/chargement.
- **Étape « langue » (7 novembre 2026, piste C des maquettes « Choisir une gare »)** : au premier lancement seulement, une carte précède les trois autres (4 étapes). Langue de l'interface en liste de boutons radio (nom de chaque langue dans sa langue, mention « Langue du téléphone » sous la langue détectée par `navigator.languages`) ; le choix s'applique et s'enregistre aussitôt (`rc:lang`) : la carte se traduit sous les yeux. Pays des gares : contrôle segmenté (code pays + nom, sans drapeau), pré-rempli d'après le fuseau horaire Intl puis la région de la langue (« fr-CH » → Suisse), **jamais par le GPS** ; enregistré (`rc:country`) à « Suivant » ou « Passer ». Seuls les pays activés sont proposés : **avec la France seule, aucun choix n'est montré** — titre « Choisissez votre langue » (au lieu de « Où allez-vous contribuer ? »), et une ligne « FR · Gares de France ; d'autres pays suivront. ». Mention en bas : « Modifiable à tout moment dans Réglages. » « Passer » garde les valeurs proposées. La configuration des pays est chargée après le démarrage (budget de poids de l'accueil).
- **Utilisateur existant** : présentation déjà vue (préférence `rc:intro`, ou `rc:onboarded`) → ni l'étape « langue » ni l'accueil ne reviennent ; « Revoir la présentation » repart de l'étape « langue ».

```
┌──────────────────────────────┐
│                     Passer › │
│                              │
│        ┌──────────────┐      │
│        │  /!\  ═══    │      │
│        │  quai | voie │      │
│        └──────────────┘      │
│                              │
│   Restez derrière la ligne   │
│   de sécurité.               │
│   Tout se fait depuis le     │
│   quai ou depuis chez vous : │
│   l'image aérienne suffit.   │
│                              │
│          ○  ●  ○             │
│ ┌──────────────────────────┐ │
│ │       J'ai compris       │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### E2 — Connexion OpenStreetMap

- **Objectif** : relier le compte OSM (OAuth2) ou permettre l'exploration sans compte.
- **Contenu** : explication courte (« Vos modifications sont publiées sous votre pseudo OSM, sous licence ODbL »), 3 options.
- **Composants** : bouton principal, bouton secondaire, lien texte, lien « En savoir plus sur OSM ».
- **Actions** : Se connecter · Créer un compte (ouvre osm.org) · Explorer sans compte.
- **États** : chargement (retour OAuth, spinner + « Connexion… ») ; erreur (« Connexion refusée ou interrompue — Réessayer ») ; hors-ligne (boutons de connexion désactivés + « Connexion possible dès le retour du réseau », « Explorer sans compte » reste actif).

```
┌──────────────────────────────┐
│                              │
│   Vos contributions vont     │
│   dans OpenStreetMap, la     │
│   carte libre et collective. │
│                              │
│   Elles sont publiées sous   │
│   votre pseudo OSM.          │
│                              │
│ ┌──────────────────────────┐ │
│ │ Se connecter avec OSM    │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Créer un compte OSM  ↗   │ │
│ └──────────────────────────┘ │
│     Explorer sans compte     │
│                              │
│   En savoir plus sur OSM ↗   │
└──────────────────────────────┘
```

### E3 — Choisir une gare

Refonte du 7 novembre 2026 : mélange des pistes A (liste enrichie) et C (à compléter) des maquettes validées par Loïc.

- **Objectif** : trouver et sélectionner une gare en < 10 s ; repartir d'un appui sur la gare en cours.
- **Contenu, de haut en bas** :
  1. Titre et ligne « France · 3 286 gares et haltes » (pays courant).
  2. Recherche (nom, commune, code UIC).
  3. **Reprendre** (champ vide) : gare de la dernière saisie en attente d'envoi, sinon dernière gare ouverte il y a moins de 24 h (`rc:lastOpened`). Nom, subdivision · distance · « hors-ligne », nombre de saisies en attente, trois jauges (quais numérotés, voies numérotées, pancartes d'arrêt) et bouton « Continuer : <première quête> » vers la quête (même ordre et même cible que la liste de E4 : carte centrée sur l'objet, ou dessin d'un quai pour Q0). Jauges et quête viennent de l'analyse locale exacte (données en cache + saisies) ; si la gare n'est plus en cache : jauges de l'index et bouton « Ouvrir la gare ».
  4. **Autour de moi** : 4 gares les plus proches et bouton « Actualiser ». Position demandée au premier appui sur « Gares autour de moi » ; ensuite (autorisation déjà donnée) obtenue sans fenêtre à l'ouverture de la page. Précision réduite, gardée en mémoire 5 min, jamais enregistrée.
  5. **À compléter près de vous** (position connue et index avec jauges) : jusqu'à 4 gares à moins de 30 km, triées par « reste à faire » décroissant puis distance. Reste à faire = objets non renseignés des trois jauges, + 1 pour une gare sans quai dans OSM (quai à dessiner).
  6. **Favorites** puis **Récentes** (sans répéter les favorites).
  7. Note : « Jauges quais · voies · pancartes : estimation d'après OpenStreetMap au <date de l'index>, mise à jour chaque semaine ; exactes pour les gares déjà ouvertes sur ce téléphone. » (seulement si une jauge est affichée).
- **Fiche de gare** (toutes les listes) : nom ; badges « Halte » (`railway=halt`), code pays (seulement si plusieurs pays sont activés et que la gare n'est pas du pays courant), icône « téléchargée pour le hors-ligne » ; commune (si différente du nom) · département « Ain (01) » (nom de la subdivision d'après la configuration du pays, chargé à part ; canton plus tard) ; à droite distance (si position connue) ou « N à faire », et **mini-jauge** à trois segments (quais, voies, pancartes ; longueur = part renseignée ; segment vide à filet si rien à relever ; masquée si aucune donnée) avec un texte équivalent pour les lecteurs d'écran ; étoile favori (bouton bascule `aria-pressed`, 44 px, préférence locale `rc:favorites`).
- **Recherche** : insensible aux accents, à la casse, aux tirets et aux apostrophes ; « st »/« ste » = « saint »/« sainte » dans les deux sens (« st » seul garde aussi sa lecture littérale : Strasbourg). Pertinence : nom exact > début du nom > début d'un mot du nom > début d'un mot de la commune > ailleurs > début du code UIC ; à pertinence égale, la plus proche d'abord (si position), sinon le nom le plus court. Nombre total de résultats, 30 premiers affichés, « les plus proches d'abord » si position. Résultats groupés par pays, pays courant d'abord ; **pas d'en-tête de groupe tant qu'un seul pays est actif**. Aide : « Accents, tirets et apostrophes sont ignorés ; « St » vaut « Saint ». »
- **Jauges sans données** : l'index publié avant le 7 novembre 2026 n'a pas de comptages : mini-jauges masquées (sauf gares déjà ouvertes sur le téléphone), « À compléter près de vous » absent, jusqu'à la prochaine construction hebdomadaire.
- **États** : chargement (« Chargement de la liste des gares… ») ; erreur d'index (bandeau) ; aucun résultat ; GPS refusé ou indisponible (bandeau, recherche par nom) ; rien de récent ni de favori (nombre de gares, « tapez au moins deux lettres »).

```
┌──────────────────────────────┐
│ Choisir une gare             │
│ France · 3 286 gares et haltes│
│ ┌──────────────────────────┐ │
│ │ 🔍 Nom de gare ou commune │ │
│ └──────────────────────────┘ │
│ ┌ REPRENDRE ─────────────☆ ┐ │
│ │ Ambérieu-en-Bugey         │ │
│ │ Ain (01) · 2,0 km         │ │
│ │ ▭ Quais numérotés ████ 4/4│ │
│ │ # Voies numérotées ███ 8/8│ │
│ │ ⚑ Pancartes      ░░░░ 0/6│ │
│ │ [ Continuer : … ›       ] │ │
│ └───────────────────────────┘ │
│ AUTOUR DE MOI     ↻ Actualiser│
│ Ambronay-Priay   4,8 km  ☆   │
│ Ambronay · Ain (01)  ▰▰▱      │
│ À COMPLÉTER PRÈS DE VOUS      │
│ Tenay-Hauteville  7 à faire ☆│
│ FAVORITES · RÉCENTES          │
│══════════════════════════════│
│  Gare     Contributions  ⚙   │
└──────────────────────────────┘
```

### E4 — Tableau de bord de la gare (quêtes)

- **Objectif** : montrer en un coup d'œil ce qui manque et lancer une quête.
- **Contenu** : nom de la gare, 3 jauges (Quais, Voies, Pancartes) avec comptes en clair, liste de quêtes priorisée, état hors-ligne de la gare.
- **Composants** : en-tête (nom + menu « Changer de gare », « Télécharger hors-ligne »), 3 tuiles jauge, bascule Liste/Carte, cartes de quête (icône objet, intitulé, nombre, chevron).
- **Actions** : ouvrir une quête, basculer vers la carte (E5), télécharger la gare, changer de gare.
- **États** : chargement (squelette des tuiles + « Chargement des données OSM de la gare… ») ; vide = gare complète (« Tout est renseigné. Vous pouvez vérifier les objets les plus anciens » + quêtes de vérification) ; gare sans aucun quai cartographié dans OSM (« Aucun quai dans OSM pour cette gare. Vous pouvez les dessiner sur l'image aérienne » → **E11**) ; erreur (« Données OSM indisponibles — Réessayer ») ; hors-ligne (données du cache avec date : « Données du 02/11 »).
- **Quai en plusieurs parties (11 novembre 2026)** : compté **une fois** dans la jauge « Quais » (fait quand toutes ses parties ont un numéro) et dans les quêtes. Parties aux numéros différents : quête « 1 quai dont les numéros sont à vérifier », sous-titre « Les parties d'un même quai n'ont pas le même numéro : à vérifier sur place ».

```
┌──────────────────────────────┐
│ ‹ Ambérieu-en-Bugey      ⋮   │
│ ⬇ Disponible hors-ligne      │
│                              │
│ ┌────────┐┌────────┐┌───────┐│
│ │▭ Quais ││═ Voies ││⚑ Panc.││
│ │ 4/6    ││ 3/8    ││ 2/12  ││
│ │▰▰▰▰▱▱  ││▰▰▰▱▱▱  ││▰▱▱▱▱▱ ││
│ └────────┘└────────┘└───────┘│
│   [ Liste ]  Carte           │
│ QUÊTES                       │
│ ┌──────────────────────────┐ │
│ │▭ 2 quais sans numéro   › │ │
│ ├──────────────────────────┤ │
│ │═ 5 voies sans numéro   › │ │
│ ├──────────────────────────┤ │
│ │⚑ Quai B : pancartes    › │ │
│ │  à positionner           │ │
│ ├──────────────────────────┤ │
│ │✓ 3 objets à vérifier   › │ │
│ └──────────────────────────┘ │
│══════════════════════════════│
│  Gare     Contributions  ⚙   │
└──────────────────────────────┘
```

### E5 — Carte de la gare

- **Objectif** : voir et sélectionner les objets dans l'espace.
- **Contenu** : fond ortho IGN (ou plan OSM en option), géométries des quais et voies, pastilles d'état (complet ✓, manquant ?, à vérifier !), pancartes.
- **Composants** : carte plein écran ; filtres en puces (Quais · Voies · Pancartes) ; bouton « Me localiser » (GPS ponctuel) ; bouton « Fond » (Ortho / Plan) ; bouton flottant « + Ajouter » en bas à droite (zone pouce) ; feuille basse de résumé d'objet au toucher.
- **Actions** : toucher un objet → feuille basse (Vérifier / Corriger) ; « + Ajouter » → choix du type → E6 ; filtrer ; changer de fond.
- **Quai sélectionné (lot 7)** : à côté du bouton compact « Renseigner », un lien discret avec icône « Modifier la forme » (« Redessiner en surface » si le quai est une ligne) vers E12, puis un bouton « Plus d'actions » (⋮) qui déplie sous les actions : « Supprimer ce quai… » et « Voir sur OpenStreetMap ». Quai en multipolygone ou relation : pas de lien de forme ; le menu dit « Quai complexe : à modifier avec un éditeur comme iD ou JOSM ».
- **Suppression (lot 7)** : la feuille montre la confirmation (jamais `confirm()`) : motif en boutons radio « En double avec un autre quai » / « N'existe plus » (désactivé hors place, avec cadenas et « Sur place seulement : la photo aérienne peut être ancienne ») ; constats : relations dont le quai sera retiré (« Il sera aussi retiré de la zone d'arrêt Gare d'Ambérieu et de 5 lignes »), nombre de points supprimés et conservés, saisies du même quai qui seront retirées ; boutons « Annuler » / « Supprimer le quai » (filet rouge). Refus (relation qui deviendrait vide, multipolygone) : message et lien OSM, pas de bouton de suppression. Après enregistrement, le quai disparaît de la carte locale et un bandeau flottant le confirme, avec un lien vers Mes contributions (pour annuler).
- **Pancarte sélectionnée (lot 7d)** : « Renseigner » puis le bouton ⋮ « Plus d'actions », qui déplie « Supprimer cette pancarte… » et « Voir sur OpenStreetMap ». Pancarte ajoutée dans l'appli, pas encore envoyée : « Voir mes contributions » (on la retire là). Les voies n'ont jamais d'action de suppression.
- **Suppression d'une pancarte (lot 7d)** : confirmation dans la feuille, titre « Supprimer cette pancarte ? » ; motif en boutons radio « En double », « Mal placée » (permis à distance) et « N'existe plus » (sur place seulement, cadenas et même mention que pour un quai) ; constat en clair de ce qui partira : « Le point sera retiré de la voie puis supprimé : la forme de la voie ne change pas. » ou « Le point reste dans la voie (point partagé avec un autre objet…) : seuls les tags de la pancarte sont retirés. La forme de la voie ne change jamais. » ; saisies de la même pancarte qui seront retirées ; « Annuler » / « Supprimer la pancarte » (filet rouge). Ensuite la pancarte disparaît de la carte locale, bandeau de confirmation avec lien vers Mes contributions.
- **Voies qui ne longent aucun quai (lot 7d)** : dessinées aussi (rien ne disparaît de la carte quand un quai change de forme), même style en plus transparent (trait à 55 %, liseré à 40 %), sans quête ; étiquette du numéro seulement s'il existe ; fiche simple « Voie 2 » / « Ne longe aucun quai cartographié » avec le seul lien « Voir sur OpenStreetMap ». Elles ne comptent pas dans la jauge « Voies ».
- **Légende (lot 7d)** : petit bouton rond « i » (libellé « Légende de la carte », `aria-expanded`) à droite des filtres ; il ouvre un panneau flottant refermable (bouton « Fermer la légende », touche Échap), au-dessus des repères de la carte : Quai, Voie, Pancarte d'arrêt, Objet sélectionné, Modifié par vous (bleu pâle), Souterrain (pointillés estompés), À compléter (« ? »), À vérifier en priorité (« ! »). Chaque ligne : une vignette dessinée comme sur la carte (sur fond gris photo) et son libellé.
- **Quai en plusieurs parties (11 novembre 2026)** : une seule étiquette, posée sur la partie principale (la plus longue à l'air libre) ; parties à l'air libre en trait plein, parties souterraines en pointillés estompés ; toucher n'importe quelle partie sélectionne le quai entier (toutes ses parties prennent la couleur de sélection, l'étiquette est pressée). Fiche : titre « Quai 3 — en 3 parties, dont 2 couvertes » ; constats propres : « Les parties de ce quai n'ont pas le même numéro : vérifiez sur place », « Numéro absent sur 1 partie du quai : à reporter sur chacune ». « Voir sur OpenStreetMap » ouvre la partie principale. **Forme et suppression par partie** : « Modifier la forme » et « Supprimer ce quai… » déplient « Quelle partie du quai ? » et une ligne par partie (« Partie à l'air libre (120 m) », « Partie couverte (40 m) ») ; la confirmation de suppression ajoute « Seule cette partie sera supprimée (…) : les autres parties du quai restent. ».
- **États** : chargement (tuiles grises + spinner discret) ; erreur tuiles (« Image aérienne indisponible — fond Plan affiché ») ; hors-ligne hors zone téléchargée (« Zone non téléchargée ») ; GPS imprécis (cercle de précision affiché + « Position à ±8 m : utilisez l'image pour placer précisément »).

```
┌──────────────────────────────┐
│ ‹ Ambérieu   [▭][═][⚑] Fond │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓ ══════════════════════ ▓▓▓│
│▓▓ ▭▭▭▭▭▭▭▭ ? ▭▭▭▭▭▭▭▭▭ ▓▓▓▓│
│▓▓ ══════(1)═════════════ ▓▓▓│
│▓▓ ══════(?)═════════════ ▓▓▓│
│▓▓ ▭▭▭▭▭▭▭▭ ✓ ▭▭▭▭▭▭▭▭▭ ▓▓▓▓│
│▓▓   ⚑8     ⚑?           ▓▓▓▓│
│▓▓ ══════(!)═════════════ ▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ (◎)                          │
│                  ( + Ajouter)│
│┌────────────────────────────┐│
││ ═ Voie sans numéro         ││
││ Entre quai A et quai B     ││
││ [ Renseigner ]             ││
│└────────────────────────────┘│
└──────────────────────────────┘
```

### E6 — Placement fin

- **Objectif** : positionner un objet à ~1 m près, à une main, sans s'approcher des voies.
- **Correction v0.2 (rapport tags § 3.5)** : une pancarte d'arrêt est un **nœud inséré dans le way de la voie**, au droit du panneau, et non sur le bord du quai. L'accrochage se fait donc sur **l'axe de la voie**. La consigne devient : « Placez le réticule sur la voie, au niveau du panneau ». Si une pancarte existe déjà à moins de 10 m, l'appli propose de la modifier plutôt que d'en créer une.
- **Lot 7d** : quais et voies souterrains en pointillés estompés, comme sur E5 ; le pas des flèches de 20 cm est désormais exact (calcul des mètres par pixel pour des tuiles MapLibre de 512 px ; il était de 10 cm).
- **Contenu** : carte ortho zoomée (zoom 20–21), réticule fixe au centre, géométrie OSM d'accrochage surlignée, loupe, indicateur de précision, consigne contextuelle.
- **Composants** :
  - **Réticule fixe** (croix jaune `#FFD400` à halo noir, contraste 14,7:1) ; la carte glisse dessous.
  - **Loupe** (×3) en haut à gauche, affichée pendant le glisser et 2 s après.
  - **Accrochage** : si le réticule est à moins de ~1,5 m d'un bord de quai / axe de voie, il « saute » dessus ; le segment accroché passe en trait épais + libellé (« Accroché : bord du quai B ») + vibration courte (si autorisée).
  - **Indicateur de précision** : « ±0,4 m · accroché » (vert) / « ±1,2 m » (orange) / « Zoomez pour plus de précision » (sous zoom 19). Calculé à partir de la résolution d'affichage et de l'accrochage, pas du GPS.
  - **Croix de micro-déplacement** (↑ ↓ ← →, pas de 0,2 m) : alternative au glisser (WCAG 2.5.7), utilisable au pouce.
  - Bouton « Détacher » pour désactiver l'accrochage.
  - Bouton principal « Valider la position ».
- **Actions** : glisser / pincer la carte, micro-déplacer, (dé)activer l'accrochage, valider, annuler.
- **États** : chargement ortho (« Chargement de l'image aérienne… », placement bloqué) ; ortho indisponible (fond Plan + avertissement « Précision limitée sans image aérienne ») ; hors-ligne hors zone téléchargée (placement désactivé, proposition « Enregistrer sans position, à placer plus tard ») ; aucune géométrie d'accrochage (placement libre, indicateur orange).

```
┌──────────────────────────────┐
│ ✕ Placer la pancarte         │
│ Réticule sur le bord du quai │
│┌─────┐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ ×3  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ ─┼─ │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│└─────┘▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━│
│▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ● Accroché : bord du quai B  │
│ Précision ±0,4 m   [Détacher]│
│            ( ↑ )             │
│      ( ← )       ( → )       │
│            ( ↓ )             │
│ ┌──────────────────────────┐ │
│ │    Valider la position   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### E7 — Fiche objet (ajout / vérification / correction)

- **Objectif** : saisir ou vérifier les attributs d'un objet en quelques touches.
- **Contenu** : en-tête (icône + type + localisation lisible « Quai B, côté voie 2 »), mini-carte de position (toucher → E6), champs, source, aide contextuelle (« Où trouver ce numéro ? » avec illustration).
- **Mode vérification** : valeurs actuelles en lecture + 2 gros boutons « C'est correct » / « Corriger ».
- **Quai en plusieurs parties (11 novembre 2026)** : bandeau d'information « Ce quai est en 3 parties, dont 2 couvertes dans OpenStreetMap : les numéros seront écrits sur chacune, dans le même envoi. » ; si les parties ont aujourd'hui des numéros différents, bandeau d'alerte « Les parties de ce quai n'ont pas le même numéro (25-26 / 26) : vérifiez sur place. Votre saisie mettra le même numéro partout. ». Préremplissage : numéros communs (ceux de la partie principale s'ils divergent). Enregistrer (ou « C'est correct ») écrit les mêmes tags sur **toutes** les parties : une seule saisie (une ligne dans Mes contributions, résumé « Quai : voies 23 (3 parties) »), un `<modify>` par partie ; si une partie a changé entre-temps, toute la saisie passe « à revoir ». Commentaire du changeset : « Quai voies 23 (3 parties) : numéro renseigné sur chaque partie ».
- **Champs par objet (alignés sur le rapport tags § 8)** :

| Objet    | Question à l'écran                                              | Tag OSM écrit                                                                                                                                                                                                                                  | Composant                                                                                                       |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Quai     | « Numéros des voies le long de ce quai »                        | `ref=1;2`                                                                                                                                                                                                                                      | 1 à 4 jetons, préremplis avec les numéros des voies voisines                                                    |
| Quai     | « Ce quai a-t-il une lettre ou un nom ? » (facultatif)          | `local_ref=A`                                                                                                                                                                                                                                  | Champ court, majuscules                                                                                         |
| Quai     | (automatique, si absents)                                       | `railway=platform`, `public_transport=platform`, `train=yes`                                                                                                                                                                                   | Ajoutés, jamais supprimés                                                                                       |
| Voie     | « Numéro ou lettre affiché en gare »                            | `railway:track_ref=A`                                                                                                                                                                                                                          | Champ court ; « Voie » ou « V » retirés automatiquement                                                         |
| Voie     | « Le numéro change-t-il le long de ce tronçon ? »               | aucun (Note OSM si oui)                                                                                                                                                                                                                        | Oui / Non                                                                                                       |
| Pancarte | « Quel panneau voyez-vous ? »                                   | `railway:signal:stop=FR:passenger_stop` + sous-clé de catégorie                                                                                                                                                                                | **Grille de vignettes (v0.3)** : TT, **n V**, **US / UM**, L…, Z57, Z50, TGV, UFR, Train long/court/tous, Autre |
| Pancarte | Vignette « n V » : « Nombre de véhicules écrit sur le panneau » | `…:conventional=FR:vehicle_number` + `…:for=vehicles` + `…:number=6`                                                                                                                                                                           | Puces 3, 4, 5, 6, 8, 10 + « Autre… » (ex. RER C 4V/6V/8V, RER D 5V/10V) ; série facultative → `…:trainset`      |
| Pancarte | Vignette « US / UM » : UM1, UM2, « 72500 US »…                  | **À valider** : le schéma 2026 ne prévoit `for=single_unit/multiple_unit` que sous Z57, Z50 et TGV. Piste : `for` + `unit_number` + `trainset=X72500`, à confirmer avec l'auteur du schéma (Noeld) sur le forum OSM France avant développement | Puces US / UM, numéro 1/2/3, série facultative                                                                  |
| Pancarte | Précision selon la vignette (variante EAS/TTL, longueur, RBT…)  | `…:for`, `…:length`, `…:reversal`                                                                                                                                                                                                              | Puces                                                                                                           |
| Pancarte | « Les trains qui lisent ce panneau vont vers… »                 | `railway:signal:direction=forward/backward` (calculé d'après le sens du way)                                                                                                                                                                   | 2 grandes flèches nommées par les gares extrêmes                                                                |
| Pancarte | « Le panneau est… » (vu du conducteur)                          | `railway:signal:position=left/right/in_track/ground`                                                                                                                                                                                           | Puces Gauche / Droite / Entre les rails / Au sol                                                                |
| Pancarte | « Un numéro sur une petite plaque ? » (facultatif)              | `ref`                                                                                                                                                                                                                                          | Champ court                                                                                                     |

**Source** : écrite au niveau du changeset (`source=survey` ou `imagery_used=BDOrtho IGN`), comme StreetComplete. Pas de question à l'utilisateur : l'appli sait s'il est sur place.
**Vérification** (« C'est correct ») : écrit `check_date=AAAA-MM-JJ` sur l'objet.
**Jamais demandé** : PK, identifiants SNCF Réseau.
**À ne pas confondre** : la plaque à **lettre seule** (A, B, R…) est un repère de quai voyageur (`railway=platform_marker`), hors MVP. L'aide « Où trouver ce panneau ? » montre la différence.
**Ancien format** : une pancarte en `FR:ARRET_*` s'affiche « ancien format » ; conversion proposée seulement si l'utilisateur confirme sur place qu'elle existe toujours.

- **Composants** : champs larges (≥ 56 dp), puces, sélecteurs segmentés, bouton principal collant en bas, lien « Voir les tags OSM » (replié, pour P3).
- **Actions** : Enregistrer · C'est correct · Corriger · Déplacer (→ E6) · Signaler disparu · Annuler.
- **États** : validation (message sous le champ, jamais par la couleur seule : icône + texte) ; donnée existante non standard (« Valeur actuelle inhabituelle : "3/4" — la conserver ? ») ; hors-ligne (aucun impact, enregistrement local) ; objet modifié par un autre entre-temps (bandeau « Cet objet a changé dans OSM — recharger »).

```
┌──────────────────────────────┐
│ ✕  ⚑ Pancarte d'arrêt        │
│    Quai B · côté voie 2      │
│ ┌──────────────────────────┐ │
│ │▓▓▓▓▓▓▓▓ ⚑ ▓▓▓▓ Déplacer ›│ │
│ └──────────────────────────┘ │
│ Texte de la pancarte         │
│ ┌──────────────────────────┐ │
│ │ 8                        │ │
│ └──────────────────────────┘ │
│ (8) (10) (US) (UM) (Autre)   │
│ Pour quels trains ? ⓘ        │
│ [Tous][Selon composition]    │
│ Sens concerné                │
│ [ ← vers Lyon ][ Genève → ]  │
│ Source                       │
│ (● Sur place) (○ Image IGN)  │
│ ⓘ Où trouver ce panneau ?    │
│ ┌──────────────────────────┐ │
│ │       Enregistrer        │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### E8 — Envoi (file d'attente)

- **Objectif** : relire et publier les modifications dans OSM, gérer hors-ligne et conflits.
- **Contenu** : modifications groupées par gare (1 changeset par gare), commentaire de changeset prérempli (« Numéros de quais et pancartes d'arrêt, gare d'Ambérieu-en-Bugey — via StationComplete »), source, état réseau.
- **Composants** : liste de modifications (icône, résumé, ancien → nouveau, supprimer), champ commentaire, bouton principal « Envoyer dans OSM », interrupteur « Envoyer automatiquement au retour du réseau ».
- **Actions** : envoyer, modifier/supprimer une modification, résoudre un conflit, se connecter (si sans compte).
- **Lot 7** : résumés « Quai A : forme modifiée (26 → 27 points) », « Quai voies 9 redessiné en surface », « Quai B-C supprimé (en double) — retiré de la zone d'arrêt X et de 5 lignes » ; icônes forme / corbeille dans la couleur des quais ; nature en clair (« Forme du quai », « Suppression · motif : … »). Le commentaire proposé suit les saisies et cite le motif des suppressions. Forme ou suppression « à revoir » : pas de « Garder », mais « Refaire » (E5 centrée sur le quai, données relues) et « Retirer ».
- **Contrôles avant envoi (QA-2, 13 novembre 2026)** : sous chaque saisie concernée, une ligne par alerte, **icône + texte** (jamais la couleur seule) : « **Erreur :** Numéro mal écrit pour railway:track_ref : « 1 ; 2 » (…) » sur fond rouge pâle, avec un lien « Corriger » (fiche E7 ou fiche Équipement ; carte E5 centrée pour une forme, un quai dessiné, un équipement placé ou une suppression) ; « **À vérifier :** Hauteur inhabituelle : 1,80 m (d'habitude entre 0,2 et 1,5 m). » sur fond ambre pâle, avec une case « J'ai vérifié ». Sous la liste : « 1 saisie ne partira pas tant qu'elle n'est pas corrigée. » et « Une saisie « à vérifier » part si vous cochez « J'ai vérifié ». ». Le bouton compte seulement les saisies qui partent (« Envoyer 1 modification ») ; s'il n'y en a aucune : « Contrôles avant envoi : aucune saisie ne peut partir. Corrigez-les ou cochez « J'ai vérifié ». ». Les saisies retenues restent sur le téléphone. Règles : `docs/architecture.md` § 4.5.6.
- **Demande de relecture (QA-3)** : sous la description, case « Je souhaite une relecture » et l'aide « Des contributeurs expérimentés pourront relire ce groupe de modifications sur OSMCha. ». **Cochée d'office** (modifiable) quand l'envoi contient une suppression, le déplacement d'un point partagé avec d'autres objets, une saisie faite en mode souterrain sur déclaration sur l'honneur, ou un avertissement « J'ai vérifié » ; l'aide ajoute alors « Cochée d'office : … ». Sinon décochée. Cochée : `review_requested=yes` sur le changeset. Le choix est gardé pour un envoi programmé hors-ligne.
- **États** : vide (« Rien à envoyer. Vos contributions apparaîtront ici. ») ; envoi en cours (barre de progression + « Envoi 2/5… ») ; succès (« Envoyé ✓ — voir le changeset ↗ ») ; erreur (« Envoi interrompu, vos modifications sont conservées — Réessayer ») ; hors-ligne (bouton remplacé par « En attente du réseau », bandeau) ; non connecté (« Connectez-vous à OSM pour publier ») ; conflit (ligne marquée « À revoir » → comparaison Votre version / Version OSM, choix « Garder la mienne » / « Garder OSM »).

```
┌──────────────────────────────┐
│ ‹ À envoyer (4)              │
│ ⚠ Hors-ligne : envoi au      │
│   retour du réseau           │
│ AMBÉRIEU-EN-BUGEY            │
│ ▭ Quai 2 : numéro « B »   ✕  │
│ ═ Voie : « 2 » ajouté     ✕  │
│ ⚑ Pancarte « 8 » ajoutée  ✕  │
│ ! Quai 1 : à revoir       ›  │
│                              │
│ Commentaire (public)         │
│ ┌──────────────────────────┐ │
│ │Numéros de quais, gare    │ │
│ │d'Ambérieu — StationComplete │ │
│ └──────────────────────────┘ │
│ Envoi auto au retour  [■■ ON]│
│ ┌──────────────────────────┐ │
│ │   En attente du réseau   │ │
│ └──────────────────────────┘ │
│══════════════════════════════│
│  Gare     Contributions● ⚙   │
└──────────────────────────────┘
```

### E9 — Mes contributions

- **Objectif** : retrouver ce que j'ai fait, ce qui attend, ce qui est à revoir.
- **Contenu** : compteurs (modifications envoyées, gares touchées), 3 segments : En attente · À revoir · Envoyées.
- **Composants** : contrôle segmenté, lignes d'historique (icône, gare, résumé, date relative, statut texte + icône), accès E8.
- **Actions** : ouvrir E8, ouvrir changeset OSM ↗, modifier une contribution en attente.
- **Lot 7** : mêmes résumés, icônes et natures que E8 ; « À revoir » affiché avec le motif ; « Retirer » annule aussi une suppression de quai en attente.
- **États** : vide (« Aucune contribution pour l'instant. Choisissez une gare pour commencer. » + bouton) ; chargement (squelettes) ; hors-ligne (historique local seul, statuts « Envoyées » non rafraîchis) ; erreur de synchronisation de l'historique (message discret, non bloquant).

```
┌──────────────────────────────┐
│ Mes contributions            │
│  127 envoyées · 9 gares      │
│ [En attente 4][À revoir 1]   │
│ [Envoyées]                   │
│ ──────────────────────────── │
│ ⚑ Ambérieu · Pancarte « 8 »  │
│   il y a 5 min · En attente  │
│ ──────────────────────────── │
│ ▭ Ambérieu · Quai 2 « B »    │
│   il y a 6 min · En attente  │
│ ──────────────────────────── │
│ ═ Meximieux · Voie « 1 »     │
│   12/10 · Envoyée ✓ ↗        │
│                              │
│ ┌──────────────────────────┐ │
│ │  Voir et envoyer (4)     │ │
│ └──────────────────────────┘ │
│══════════════════════════════│
│  Gare     Contributions● ⚙   │
└──────────────────────────────┘
```

### E10 — Réglages

- **Objectif** : maîtriser compte, apparence, données hors-ligne, confidentialité.
- **Contenu** :
  - Compte OSM (pseudo, se déconnecter).
  - Apparence : Thème (Système / Clair / Sombre), Taille du texte (suit le système), Contraste renforcé « plein soleil ».
  - Carte : fond par défaut (Ortho IGN / Plan), vibration à l'accrochage.
  - Hors-ligne : gares téléchargées (taille, date, supprimer), envoi auto au retour du réseau.
  - Mode expert : afficher les tags OSM bruts.
  - Langue, À propos (licences ODbL / IGN, code source), Rappel sécurité.
  - **Pays des gares** (7 novembre 2026), juste sous la langue : liste des pays activés (préférence `rc:country`, choisie au premier lancement). Avec un seul pays activé, la ligne affiche le pays sans sélecteur (« Seul pays disponible pour l'instant. »).
- **Composants** : liste de réglages groupés, interrupteurs ≥ 48 dp, sélecteurs.
- **États** : hors-ligne (déconnexion/connexion indisponibles, le reste fonctionne).

```
┌──────────────────────────────┐
│ Réglages                     │
│ COMPTE                       │
│ @julien_rail    Déconnexion  │
│ APPARENCE                    │
│ Thème        Système      ›  │
│ Plein soleil         [□ OFF] │
│ CARTE                        │
│ Fond par défaut  Ortho IGN › │
│ Vibration accrochage [■ ON]  │
│ HORS-LIGNE                   │
│ Gares téléchargées (2) 48 Mo›│
│ Envoi auto           [■ ON]  │
│ AVANCÉ                       │
│ Afficher les tags OSM [□ OFF]│
│ Langue       Français     ›  │
│ Sécurité · À propos       ›  │
│══════════════════════════════│
│  Gare     Contributions  ⚙   │
└──────────────────────────────┘
```

### E11 — Dessiner un quai (ajout v0.2)

- **Objectif** : créer un quai absent d'OSM, sur l'image aérienne, sans compétence d'édition.
- **Principe (v0.3, demande de Loïc)** : **polygone libre**. L'utilisateur fait le tour du quai coin après coin avec le réticule fixe (« Ajouter un point »), puis ferme la forme en touchant le point 1 ou avec « Fermer le quai ». Les points proches de la voie s'accrochent sur une ligne parallèle à ~1,5 m de l'axe, pour que le bord côté voie reste parallèle. Outils : annuler le dernier point, déplacer un point (sélection puis croix de micro-déplacement), longueur des côtés affichée. Minimum 3 points, contrôle des côtés qui se croisent.
- **Tags créés** : `railway=platform` + `public_transport=platform` + `train=yes` + `area=yes` si besoin, puis passage direct sur E7 pour les numéros (sur place) ou enregistrement sans numéro (à distance → quête Q1 créée).
- **Non fait au MVP** : quais à trou (multipolygones), bords de quai `platform_edge`, ajout à la relation `stop_area` (signalé dans le commentaire du changeset pour les cartographes).
- **Garde-fous** : longueur minimale 20 m et maximale 800 m ; alerte si le rectangle chevauche une voie ou un quai existant ; bouton « Annuler le dernier point ».
- **Accrochage (lot 7d)** : le point ajouté est exactement sous la croix ; il n'est ramené au bord de la voie (1,5 m de l'axe, axe à moins de 4 m) que si le point accroché est à moins de 12 px de la croix au zoom courant. Accroché : croix jaune + petit trait jaune de la croix au point accroché, et « Accroché au bord de la voie » dans le panneau ; sinon « Point sous la croix », sans point séparé. Interrupteur « Accrocher à la voie » (`role=switch`, activé par défaut, mémorisé sur le téléphone) pour le couper.
- **Voie qui n'est plus longée (lot 7d)** : à « Fermer le quai », si un point a été accroché au bord d'une voie et que la forme finale ne longe pas cette voie (règle des quêtes), bandeau d'avertissement (`role=alert`) dans le panneau : « Le quai ne longe plus la voie 2 (bord à 9 m). Vérifiez la forme : le bord du quai doit suivre la voie. » (« bord plus parallèle à la voie » quand le bord reste proche mais l'orientation a changé), boutons « Corriger » (referme le bandeau, on reste) et « Enregistrer quand même ». Toute nouvelle action referme le bandeau.
- **Glisser un point (lot 7d)** : un point déjà posé se glisse au doigt (aperçu du contour pendant le glisser, même règle d'accrochage au relâcher, annonce « Point 2 déplacé »). « Annuler le point » devient « Annuler le déplacement » après un déplacement (pile d'historique). La croix et « Déplacer le point ici » restent l'alternative sans glisser.
- **États** : ortho indisponible → dessin bloqué (« L'image aérienne est nécessaire pour dessiner un quai ») ; hors-ligne avec zone téléchargée → possible, envoi différé.

```
┌──────────────────────────────┐
│ ✕ Dessiner un quai     2 / 3 │
│ Placez la fin du bord côté   │
│ voie                         │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ ← voie
│▓▓ ●- - - - - - - - -╋ ▓▓▓▓▓▓▓│ ← bord en cours
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ Longueur 142 m · le long de  │
│ la voie 2                    │
│ [↶ Annuler le point]         │
│ ┌──────────────────────────┐ │
│ │      Placer ce point     │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### E12 — Modifier un quai (ajout lot 7)

- **Objectif** : corriger la forme d'un quai existant, ou remplacer un quai tracé en ligne par une surface, sur la photo aérienne, sans casser les objets voisins.
- **Route** : `/gare/forme?id=<gare>&osm=way/<id>`, chargée à la demande (hors budget de démarrage).
- **Reprend E11** : carte plein écran, croix fixe au centre (accrochage au bord de voie à 1,5 m, croix jaune), en-tête flottant (fermer, titre, nombre de points, consigne), zoom et pavé de flèches repliable « Ajuster au centimètre », panneau bas flottant.
- **Sommets** : chaque sommet est un bouton (« Point 2 : le sélectionner »). Sommet **partagé** (dans un autre objet — gare, bâtiment, toit, chemin, espace intérieur, bord de quai… —, tagué, ou membre d'une relation) : rond blanc à cœur sombre, discret, libellé « Point 16 : aussi un point de la gare, le sélectionner » ; il se **déplace** comme les autres (lot 7c). Sommet **verrouillé** (rare : point répété dans le contour, ou point relié en « redessiner en surface ») : carré sombre cerclé de blanc, « Déplacer » et « Retirer » désactivés.
- **Ce qui suivra, dit avant** : point partagé sélectionné → ligne d'information sous la consigne (icône i, `role=note`) : « Ce point est aussi un point de : la gare et un bâtiment — ils suivront le déplacement. Retiré, il reste dans la gare et un bâtiment ; seul le quai change. » Point tagué : « Ce point est un ascenseur : il sera déplacé. » Après l'action : « Point 4 déplacé : toit et bord du quai ajustés aussi. » / « Point 16 retiré du quai. Retiré, il reste dans la gare ; seul le quai change. ». Récapitulatif E8/E9 et résumé de la saisie : « Quai voies 2b : forme modifiée (24 → 24 points) — gare et bâtiment ajustés aussi » ; commentaire proposé du changeset : « … forme de quai corrigée (gare et bâtiment ajustés aussi) ».
- **Bord de quai** : un sommet partagé avec un `railway=platform_edge` se déplace (le bord suit) mais **ne se retire pas** (le bord deviendrait incohérent avec le quai) : « Il ne peut pas être retiré du contour : le bord du quai en a besoin. » En « redessiner en surface », les points partagés de l'ancienne ligne restent fixes (à reprendre tels quels).
- **Bandeau d'ouverture** : si au moins 3 points (ou un quart) sont partagés, une note sobre et refermable (« Compris ») sous la consigne : « 22 points sur 24 sont partagés avec d'autres objets (gare, bâtiment…) : ils suivront vos modifications. » Les points tagués y sont toujours signalés (« Les points 15 et 16 portent des informations (entrée) : les déplacer déplace ces objets. »).
- **Sélection à la croix** : « Prendre ce point » sélectionne le sommet le plus proche de la croix s'il est à moins de 24 px à l'écran (modifiable de préférence ; en « redessiner », reprend aussi un point de l'ancienne ligne), sinon « Aucun point sous la croix : amenez la croix sur un point du quai (rond blanc), ou touchez directement le point. » (le bouton reste actif : le message explique). « Ajouter un point ici » insère un point **sous la croix** (accroché à la voie selon la règle habituelle) sur le côté le plus proche, s'il passe à moins de 24 px. Toucher un sommet reste possible.
- **Cibles sans recouvrement** : chaque repère prend la place libre autour de lui (44 px au plus, 24 px au moins) et aucun n'est posé sous un menu flottant ; un sommet trop serré reste visible mais n'est pas une cible à ce zoom (on zoome, ou on le prend à la croix). Les repères « + » n'apparaissent que sur les côtés d'au moins 48 px à l'écran. Les menus flottants sont toujours au-dessus des repères (contexte d'empilement propre à la carte, `isolation: isolate`, aussi sur E5, E6, E11).
- **Vue (lot 7c)** : ouvert depuis E5, E12 reprend **exactement** le centre et le zoom de l'utilisateur (`&z=19.30&c=lon,lat` dans l'URL) ; il ne se cadre sur le quai (marge 72 px, zoom ≤ 20) que sans vue d'origine (lien direct) ou si le quai est entièrement hors de l'écran. « Terminer » et « Quitter » rendent à E5 la vue de E12. Pas de zoom au double toucher (deux sommets touchés coup sur coup ne zooment pas) : zoom par les boutons +/− ou le pincement.
- **Sélection** : la carte glisse (200 ms, immédiat si « réduire les animations ») pour que le point soit sous la croix, **sans changer le zoom** ; rien ne bouge s'il y est déjà ; on fait glisser la carte (ou le pavé) puis « Déplacer le point ici ». « Retirer ce point » (au moins 3 points). Longueurs affichées seulement pour les deux côtés du point sélectionné.
- **Accrochage et glisser (lot 7d)** : comme E11 — point exactement sous la croix, accrochage seulement à moins de 12 px de la croix (croix jaune + trait vers le point accroché), interrupteur « Accrocher à la voie ». Un sommet modifiable se glisse aussi au doigt (marqueur déplaçable, cible de 24 à 44 px, `touch-action: none` sur le sommet seulement : toucher à côté fait glisser la carte) : aperçu du contour pendant le glisser ; au relâcher, même accrochage, annonce « Point 4 déplacé » (avec ce qui suit, pour un point partagé), « Annuler » annule ce déplacement, contrôles à « Terminer ». Un sommet fixe (carré) ne se glisse pas. Un toucher sans glisser sélectionne le point, comme avant. Le zoom de l'utilisateur ne change pas.
- **Voie qui n'est plus longée (lot 7d)** : à « Terminer », après les contrôles bloquants, si une voie que longeait le quai d'origine (données lues) ne le longe plus avec la nouvelle forme (même règle que les quêtes), même bandeau qu'en E11 (« Le quai ne longe plus la voie 2 (bord à 9 m). Vérifiez la forme : le bord du quai doit suivre la voie. »), « Corriger » / « Enregistrer quand même ». Non bloquant : la voie reste dessinée sur E5 de toute façon.
- **Actions** : « Annuler » (dernière action, pile d'historique), « Terminer » (contrôles puis enregistrement, retour à E5 centrée sur le quai), « Quitter sans enregistrer » (✕).
- **Redessiner en surface** : contour vide au départ, ancienne ligne en trait pâle et large (lot 7d : les pointillés sont réservés aux objets souterrains) ; « Ajouter un point » au réticule ; les points partagés de l'ancienne ligne apparaissent en carrés pointillés (« Point relié 2 de l'ancienne ligne : l'ajouter au contour ») et doivent tous être repris, sinon « Terminer » refuse avec un message (et renvoie vers iD/JOSM).
- **Contrôles à « Terminer »** : `checkShape` (≥ 3 points, pas de côtés croisés, 20–800 m, ne croise pas une voie, ne chevauche pas un autre quai — le quai lui-même exclu), points fixes respectés (aucun point de bord de quai retiré), au moins un changement.
- **Accessibilité** : alternatives sans glisser (pavé, boutons), annonces `aria-live` (« Point 4 ajouté entre 3 et 4 », « Point 2 déplacé », « Dernière action annulée »), erreurs en `role=alert`, cibles de 24 à 44 px sans recouvrement, alternative sans viser (croix), clair et sombre, axe sans violation (canevas exclu, marqueurs testés).
- **États** : chargement ; quai introuvable ; quai complexe (multipolygone) → message, lien OSM, retour.

---

## 4. Système de quêtes et indicateurs de complétude

### 4.1 Définition d'une quête

Une quête = **un manque ou un doute détecté automatiquement** dans les données OSM de la gare, formulé en langage voyageur, regroupé par type et par quai.

| Quête                  | Condition de détection (à aligner sur le rapport tags)                                                        | Formulation                                     | Écran ouvert                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Q0 Quais absents       | Aucun `railway=platform`/`public_transport=platform` dans l'emprise de la gare                                | « Aucun quai cartographié »                     | **E11**                                  |
| Q1 Numéro de quai      | Quai sans `ref`                                                                                               | « 2 quais sans numéro »                         | E5 centré → E7 (sur place)               |
| Q2 Numéro de voie      | `railway=rail` longeant un quai, sans `railway:track_ref`                                                     | « 5 voies sans numéro »                         | E5 centré → E7 (sur place)               |
| Q3 Lien quai–voie      | `ref` du quai ≠ `railway:track_ref` des voies adjacentes                                                      | « Quai A : numéros à vérifier »                 | E7                                       |
| Q4 Pancartes d'arrêt   | Tronçon de voie le long d'un quai sans nœud `railway:signal:stop`                                             | « Quai B : pancartes à relever »                | E6 (série, sur place)                    |
| Q5 Pancarte incomplète | Pancarte sans `railway:signal:direction`, ou en ancien format `FR:ARRET_*`                                    | « 3 pancartes à compléter »                     | E7 (sur place)                           |
| Q6 Vérification        | Objet sans `check_date` ou `check_date` > 2 ans                                                               | « 3 objets à vérifier »                         | E7 (vérif.)                              |
| Q7 Incohérence         | Deux voies de la gare avec le même `railway:track_ref`, valeur non standard (« Voie 1 » dans `name`)          | « Deux voies portent le numéro 2 »              | E7                                       |
| Q9 Ascenseur           | `highway=elevator` sans `wheelchair` (lot Équipements)                                                        | « 3 ascenseurs : accès en fauteuil à préciser » | E5 centré → fiche Équipement (sur place) |
| Q8 Équipements du quai | Quai sans `height`, `passenger_information_display`, `shelter`, `tactile_paving` ou `bench` (lot Équipements) | « 2 quais : équipements à relever »             | E5 centré → E7 (sur place)               |

Les quêtes marquées « sur place » s'affichent à distance avec un cadenas et la mention « À faire en gare ».

### 4.2 Priorisation (ordre d'affichage sur E4)

1. Incohérences (Q7) — impact fort sur OSRD.
2. Numéros de quais (Q1) puis de voies (Q2) — prérequis aux pancartes.
3. Liens quai–voie (Q3).
4. Pancartes (Q4, Q5) — groupées **par quai** pour une session sur place cohérente.
5. Vérifications (Q6).

Si l'utilisateur est **sur place** (GPS récent dans la gare), les quêtes « sur place » (pancartes, numéros affichés) remontent ; **à distance**, les quêtes faisables sur ortho (lien quai–voie, positionnement d'objets visibles) remontent, avec la mention « Vérifiable sur l'image aérienne ».

### 4.3 Indicateurs de complétude

- Par type : **compte en clair** « 4/6 quais numérotés » + jauge segmentée (1 segment par objet jusqu'à 12, sinon proportionnelle). Jamais de pourcentage seul.
- Pancartes : dénominateur = quais (« 2 quais sur 6 ont leurs pancartes »), car le nombre réel de pancartes est inconnu tant que personne ne les a relevées.
- Gare : 3 états textuels, avec icône : « À compléter » · « Presque complète » (tout Q1–Q3 fait) · « Complète » (Q1–Q5 faits, aucune incohérence). Affichés dans les résultats de E3.
- Fraîcheur : « Dernière vérification : il y a 3 mois ».

### 4.4 Motivation (sobre)

- Retour immédiat après chaque saisie (bandeau + jauge qui se met à jour, sans animation).
- Proposition « Suivante sur ce quai » pour enchaîner.
- Compteurs personnels sur E9. Pas de classement ni de badges au MVP (voir question ouverte 4).

---

## 5. Principes visuels

### 5.1 Palette et jetons (refonte v1, contrastes WCAG calculés)

Jetons CSS de `src/app.css` (noms utilisés par tout le code). Le thème suit le téléphone, ou le réglage E10 (`<html data-theme="light|dark">`).

| Jeton                                                           | Clair                             | Sombre                            | Rôle                                                                          |
| --------------------------------------------------------------- | --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `--bg`                                                          | `#FFFFFF`                         | `#161412`                         | fond                                                                          |
| `--surface` / `--surface-2`                                     | `#F5F5F4` / `#EBEBEA`             | `#201D1A` / `#2A2723`             | bandeaux, segmentés / bouton désactivé                                        |
| `--border` / `--border-strong`                                  | `#D3D1CF` / `#8A8681`             | `#3B3733` / `#77736E`             | filets décoratifs / contours de champs et boutons secondaires                 |
| `--text` / `--text-2` / `--text-3`                              | `#1F1B17` / `#5C5955` / `#706C67` | `#F2F0EE` / `#B6B2AF` / `#94918E` | texte, secondaire, chevrons et indications                                    |
| `--primary`                                                     | **`#1844EF`** (bleu OSRD)         | **`#8098F6`**                     | seul bleu d'action : boutons, liens, sélection                                |
| `--primary-hover` / `--primary-soft` / `--on-primary`           | `#1336C4` / `#E8EFFD` / `#FFFFFF` | `#97ABF8` / `#1E2A44` / `#10131A` | survol, choix sélectionné, texte sur bouton                                   |
| `--quai` (+ `-soft`)                                            | `#2D6B65` / `#E7F1EF`             | `#7CC6BC` / `#1B2A28`             | famille quai                                                                  |
| `--voie` (+ `-soft`)                                            | `#57508C` / `#EEEDF6`             | `#AFA8E8` / `#25233A`             | famille voie                                                                  |
| `--pancarte` (+ `-soft`)                                        | `#85561A` / `#F7F0E4`             | `#D8A660` / `#2E2518`             | famille pancarte                                                              |
| `--ok` / `--missing` / `--danger` (+ `-soft`)                   | `#0B723C` / `#7D521E` / `#C42B21` | `#5FCB8E` / `#E2B256` / `#FF8A80` | sémantique atténuée ; rouge réservé aux incohérences                          |
| `--on-danger`                                                   | `#FFFFFF`                         | `#1F1B17`                         | texte sur bouton rouge                                                        |
| `--overlay` / `--overlay-line`                                  | blanc 96 % / filet 12 %           | `#1A1714` 94 % / filet blanc 14 % | contrôles flottants sur la carte                                              |
| `--radius` / `--radius-lg` / `--radius-sheet` / `--radius-pill` | 6 / 8 / 12 / 999 px               |                                   | boutons et champs / listes, tuiles, barres flottantes / feuille basse / puces |
| `--target` / `--target-min`                                     | 48 / 44 px                        |                                   | cibles principales / flottantes                                               |

Contrastes (sortie de `node scripts/contrast.mjs`, formule WCAG 2.x) :

| Paire (texte / fond)         | Clair   | Sombre  | Usage                                |
| ---------------------------- | ------- | ------- | ------------------------------------ |
| `text` / `bg`                | 17,11:1 | 16,16:1 |                                      |
| `text` / `surface`           | 15,68:1 | 14,75:1 |                                      |
| `text-2` / `bg`              | 6,96:1  | 8,73:1  |                                      |
| `text-2` / `surface`         | 6,38:1  | 7,97:1  |                                      |
| `text-2` / `surface-2`       | 5,84:1  | 7,06:1  | bouton désactivé                     |
| `text-3` / `bg`              | 5,21:1  | 5,86:1  |                                      |
| `primary` / `bg`             | 6,75:1  | 6,77:1  | liens, bouton discret                |
| `primary` / `surface`        | 6,19:1  | 6,18:1  |                                      |
| `primary` / `primary-soft`   | 5,85:1  | 5,27:1  | choix sélectionné                    |
| `on-primary` / `primary`     | 6,75:1  | 6,85:1  | bouton principal                     |
| `quai` / `bg`                | 6,17:1  | 9,33:1  |                                      |
| `quai` / `quai-soft`         | 5,36:1  | 7,57:1  |                                      |
| `voie` / `bg`                | 7,16:1  | 8,39:1  |                                      |
| `voie` / `voie-soft`         | 6,17:1  | 6,95:1  | jetons E7                            |
| `pancarte` / `bg`            | 6,28:1  | 8,35:1  |                                      |
| `pancarte` / `pancarte-soft` | 5,55:1  | 6,85:1  |                                      |
| `ok` / `bg`                  | 6,02:1  | 9,12:1  |                                      |
| `missing` / `bg`             | 6,78:1  | 9,39:1  |                                      |
| `missing` / `missing-soft`   | 6,13:1  | 7,65:1  |                                      |
| `danger` / `bg`              | 5,65:1  | 8,05:1  |                                      |
| `danger` / `danger-soft`     | 4,97:1  | 6,66:1  |                                      |
| `on-danger` / `danger`       | 5,65:1  | 7,49:1  | bouton « Tout effacer »              |
| `text` / `missing-soft`      | 15,48:1 | 13,16:1 | bandeau                              |
| `text` / `danger-soft`       | 15,03:1 | 13,37:1 | bandeau                              |
| `border-strong` / `bg`       | 3,62:1  | 3,90:1  | contour de champ, 1.4.11             |
| `knob` / `border-strong`     | 3,62:1  | 4,14:1  | interrupteur éteint, 1.4.11          |
| `primary` / `surface-2`      | 5,66:1  | 5,48:1  | interrupteur allumé sur fond, 1.4.11 |

Carte (identique dans les deux thèmes ; fonds de référence ballast `#857C6F`, béton `#AEA89C`) — `src/lib/map/style.ts` :

| Élément               | Valeur                                             | Contraste                                                                              |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Voie                  | trait `#E4E0FF` sur liseré `#14110E` à 70 %        | trait/ballast 3,21:1 ; trait/liseré 10,06:1 ; liseré/béton 4,49:1                      |
| Quai                  | contour `#B5EDE4`, remplissage 16 % (10 % dès z18) | porté par le liseré (≥ 3:1 sur les deux fonds)                                         |
| Modifié par vous      | `#B3C8FF`                                          | porté par le liseré                                                                    |
| Sélection, accrochage | `#FFF700` + halo                                   | 3,63:1 sur ballast                                                                     |
| Souterrain (lot 7d)   | pointillés 2/2, trait à 60 %, liseré à 30 %        | forme (pointillés) + estompé ; jamais la couleur seule                                 |
| Étiquette             | fond `#1F1B17` à 86 %, texte blanc 11 px / 600     | 13,3 à 14,3:1 ; « ? » `#FFE08A` 11,05:1 ; sélectionnée `#1F1B17` sur `#FFF700` 15,12:1 |
| Croix de visée        | blanche 1,5 px sur liseré 3,5 px à 75 %            | 4,11:1 sur ballast ; liseré/béton 5,01:1                                               |

Épaisseurs (px, interpolées selon le zoom) : voie 0,75 (z15) → 1,25 (z17) → 1,6 (z18) → 2 (z19) → 3 (z21), liseré = trait + 1,5 ; quai 0,75 → 1 → 1,25 → 1,5 → 2.

Règles :

- La photo IGN reste intacte ; chaque tracé = trait clair + liseré sombre (WCAG 1.4.11 tenu par au moins une frontière).
- Pointillés estompés = souterrain (lot 7d : tunnel, couche ou niveau négatif, `location=underground`), sur E5, E6, E11, E12 ; « ? » = à compléter, « ! » = alerte (étiquettes, trait plein) ; point bleu = modifié ; jaune = sélection. Jamais la couleur seule. Légende sur E5 (bouton « i »).
- Étiquettes : z < 17 point d'état seulement ; 17–18 quais + voies à compléter ou en alerte ; ≥ 18 toutes les voies ; ≥ 18,5 plaques des pancartes. Placement sans chevauchement recalculé à chaque fin de déplacement (5 à 8 positions essayées le long de l'objet, hors des contrôles flottants), sinon masquée (l'objet reste touchable sur son trait).
- Ombres réservées à ce qui flotte (contrôles de carte, feuille basse, bouton principal léger).

### 5.2 Typographie

- **Atkinson Hyperlegible Next**, 400 et 600 (jamais 700 : faux gras), auto-hébergée ; repli `system-ui`. Chiffres tabulaires pour compteurs, jauges et numéros.
- Échelle (rem, suit la taille système) : titre d'écran 24/32 · titre d'accueil 26/32 · barre d'en-tête 18/24 (17 sur les barres flottantes) · sous-titre de section 17/24 · corps 16 · secondaire 14/20 · surtitre et onglets 13/16 · numéro dans un champ 28 · étiquette de carte 11.

### 5.3 Iconographie

Jeu maison (`src/lib/icons.ts`, composant `Icon.svelte`) : grille 24 px, trait 1,5 px, extrémités arrondies, `currentColor`. Tailles 24 (onglets, en-têtes), 20 (boutons), 18 (bandeaux, constats), 14–16 (méta).

| Objet            | Pictogramme                   | Marqueur sur la carte                                         |
| ---------------- | ----------------------------- | ------------------------------------------------------------- |
| Quai             | rectangle avec bord intérieur | pastille à coins de 2 px                                      |
| Voie             | deux rails et traverses       | pastille ronde                                                |
| Pancarte d'arrêt | plaque sur mât                | plaque blanche sur mât (≥ z18,5), petit rond blanc en dessous |

### 5.4 Ton rédactionnel

- **Vouvoiement**, phrases courtes, verbes d'action (« Placez », « Vérifiez »).
- **Vocabulaire voyageur** à l'écran (« numéro du quai », « panneau d'arrêt ») ; termes OSM (« changeset », « tag ») seulement en mode expert ou entre parenthèses la première fois.
- Rassurant sur l'erreur : « Pas d'inquiétude, vous pourrez corriger avant l'envoi. »
- Messages de sécurité **fermes et sobres**, jamais culpabilisants : « Restez derrière la ligne de sécurité. Tout se fait depuis le quai. »
- Remerciement factuel, sans emphase : « Merci, c'est enregistré. »
- i18n : toutes les chaînes externalisées, pas de texte dans les images, prévoir +30 % de longueur (allemand), pluriels gérés (ICU).

---

## 6. Accessibilité et sobriété — check-list pour les maquettes

- Cibles tactiles ≥ 48 × 48 dp, espacées de 8 dp ; actions principales dans le tiers inférieur (usage à une main).
- Alternative à tout glisser (croix de micro-déplacement, boutons zoom +/−) — WCAG 2.5.7.
- Focus visible, ordre de lecture logique, libellés pour lecteurs d'écran sur la carte (« Quai B, numéroté, 2 pancartes »). Vue **Liste** équivalente à la carte (E4).
- Pas d'authentification à mémoriser (OAuth OSM) — WCAG 3.3.8.
- Respect de `prefers-reduced-motion` ; aucune animation décorative ; transitions ≤ 150 ms.
- GPS uniquement sur action explicite, coupé après obtention ; pas de suivi continu.
- Hors-ligne : pré-téléchargement explicite d'une gare (données OSM + ortho zoom 17–20 dans un rayon ~800 m), taille affichée avant téléchargement.
- Message de sécurité : à l'onboarding, en rappel discret sur E6 la première fois, et dans Réglages.

---

## 7. Questions ouvertes pour Loïc

1. **Envoi** : un changeset par gare après relecture sur E8 (proposé), ou envoi immédiat à chaque objet (plus simple mais plus de changesets et moins de contrôle) ?
2. **Pancartes d'arrêt** : quel niveau de détail au MVP — seulement position + texte de la pancarte, ou aussi les conditions (composition US/UM, longueur, type de train) et le sens ? Dépend du rapport tags et des besoins réels d'OSRD.
3. **Contribution à distance** : l'autoriser pour tous les objets, ou réserver l'ajout de numéros et de pancartes à « sur place » (non visibles sur l'ortho) et laisser le distant aux positions/vérifications ? Faut-il une photo de preuve (ex. via Panoramax), hors OSM ?
4. **Motivation** : rester sur des compteurs personnels sobres (proposé), ou ajouter badges / classement par gare pour l'engagement ?
5. **Gares sans quais dans OSM** : le MVP se limite-t-il aux gares dont les quais existent déjà (proposé : signalement via note OSM), ou faut-il permettre de dessiner un quai (forte complexité UX) ?
