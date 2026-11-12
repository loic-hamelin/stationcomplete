# stationcomplete

Application web mobile (PWA) pour compléter, dans [OpenStreetMap](https://www.openstreetmap.org/), les données ferroviaires des gares françaises : numéros des quais, numéros des voies, pancartes d'arrêt des trains.

Site : <https://stationcomplete.org>

> **Sécurité** : restez toujours derrière la ligne de sécurité. Tout se fait depuis le quai ou à distance, sur la photo aérienne.

## État

- Lot 0a : page d'accueil (présentation et consignes de sécurité) et page « À propos », publiées sur stationcomplete.org.
- Lot 0b : appli installable (manifeste, icônes), ouverture sans réseau (service worker), garde-fous automatiques (tests, accessibilité, budget de poids).
- Lot 1 : recherche d'une gare, tableau de bord (complétude, quêtes), carte sur la photo aérienne IGN.
- Lot 2 : saisie locale des numéros de quais et de voies et des pancartes d'arrêt (placement fin, schéma FR:passenger_stop).
- Lot 3 : connexion au compte OpenStreetMap (OAuth2 PKCE) et envoi d'un changeset par gare, résilient aux coupures et aux conflits. Envoi ouvert sur le serveur de test uniquement (production au lot 6).
- Lot 4 : hors-ligne — téléchargement d'une gare (données + photos aériennes, taille affichée), consultation et saisie sans réseau, envoi programmé qui part tout seul au retour du réseau, gestion des gares téléchargées.
- Lot 5 : dessin d'un quai absent d'OSM (polygone au réticule, accrochage parallèle à 1,5 m de l'axe de la voie, contrôles de forme), puis numérotation et envoi.
- Lot 7 : modifier un quai existant — forme (déplacer, ajouter, retirer des sommets ; un point partagé avec d'autres objets peut être déplacé, ils suivent, et l'appli le dit avant ; jamais supprimé), quai tracé en ligne redessiné en surface (même way), suppression d'un quai avec motif et retrait de sa zone d'arrêt.
- Lot 7d : suppression d'une pancarte d'arrêt existante (nœud retiré de la voie seulement si c'est sans risque, sinon tags retirés ; la géométrie des voies ne change jamais), pointillés estompés réservés aux objets souterrains et légende de la carte, accrochage limité à 12 px de la croix et sommets glissés au doigt.
- Lot P1 : organisation par pays, sans changement visible. Tout ce qui est propre à un pays (index des gares, photo aérienne, schéma des pancartes, subdivision, règles de quêtes, langues) est décrit dans `src/lib/core/countries.ts` ; la politique de sécurité, le service worker et la construction hebdomadaire de l'index en découlent. Seule la France est activée ; la Suisse est déclarée mais désactivée.
- Choisir une gare (E3, 7 novembre 2026) : carte « Reprendre » (gare en cours, jauges, prochaine tâche), recherche par pertinence puis distance (accents, tirets, « St » = « Saint »), gares autour de moi, « À compléter près de vous », favorites et récentes en fiches (distance, département, halte, hors-ligne, mini-jauge quais · voies · pancartes). L'index hebdomadaire porte les jauges de chaque gare, calculées par le moteur de quêtes de l'appli. Langue (et pays, quand il y en aura plusieurs) choisis à la première ouverture, modifiables dans Réglages.
- Quai en plusieurs parties (11 novembre 2026) : un quai découpé dans OSM en parties à l'air libre et couvertes (Paris-Saint-Lazare) est regroupé en un seul quai — une étiquette, compté une fois dans les quêtes et les jauges, numéro écrit sur toutes ses parties dans le même envoi. Rien n'est fusionné dans OSM.
- Équipements (11 novembre 2026), étape 1 : caractéristiques des quais relevées sur place dans la fiche du quai (hauteur, écrans d'affichage, abri, bandes podotactiles, bancs), quête « équipements à relever » et 4e jauge « Équipements » sur le tableau de bord (hors index hebdomadaire).
- Équipements, étape 2 : ascenseurs et distributeurs de billets — affichés sur la carte (filtre « Équipements », légende), ajoutés sur la photo aérienne ou situés par rapport à un quai (intérieur, souterrain), complétés, supprimés avec motif (nœud isolé seulement) ; doublon à moins de 5 m signalé.
- Équipements, étape 3 : escaliers, escaliers mécaniques et tapis roulants existants affichés (trait fin, flèche vers le haut ou sens de marche) et complétés sur place (sens relatif au chemin, jamais retourné ; mains courantes, bandes podotactiles, nombre de marches).
- Lot S1 (12 novembre 2026) : état officiel des ascenseurs et escaliers mécaniques sur la page d'une gare française (open data SNCF Gares & Connexions, ODbL), en lecture seule et sans rien stocker, avec les canaux officiels pour signaler une panne (décision D4 bis, `docs/architecture.md` § 8.6). Coupure possible par `static/config.json` (`officialStatusEnabled`).
- Lot traduction : interface en français, anglais, allemand, italien et espagnol. Langue détectée au premier lancement d'après le téléphone, modifiable dans Réglages ; seule la langue active est téléchargée. Le commentaire proposé du changeset est rédigé dans la langue de l'interface ; les tags ne se traduisent jamais.

## Développer sur son ordinateur

Prérequis : [Node.js](https://nodejs.org/) 22.18 ou plus récent (les scripts lisent directement la configuration des pays écrite en TypeScript).

```sh
npm install        # installe les dépendances (une seule fois)
npm run dev        # lance le site sur http://localhost:5173
npm run check      # vérifie les types
npm run lint       # vérifie la mise en forme et le code
npm run build      # construit le site statique dans build/
npm run budget     # vérifie le budget de poids (après build)
npm run test:e2e   # tests de bout en bout : parcours, accessibilité, hors-ligne (après build)
```

Première fois pour les tests : `npx playwright install chromium`.

## Pays

L'appli est organisée par pays : chaque gare appartient au pays de son index (`static/data/stations-<cc>.json`) et suit la configuration de ce pays. Pour ajouter un pays, suivre la check-list de `docs/architecture.md` (§ 13.5). Un index se construit localement, à partir d'un export osmium, avec :

```sh
node scripts/build-stations.mjs rail-fr.geojsonseq --country fr
```

## Langues

Textes de l'interface : `src/lib/i18n/messages/<langue>.json` (fr, langue source ; en, de, it, es). Ajouter une chaîne ou une langue : `docs/architecture.md` (§ 9.2). Vocabulaire : `docs/i18n/glossaire.md`. Relecteurs bénévoles : `docs/i18n/relecture.md`. Un test unitaire vérifie que chaque clé existe dans les cinq langues avec les mêmes paramètres.

## Publication

Chaque envoi sur la branche `main` déclenche le workflow `.github/workflows/deploy.yml`, qui vérifie (types, mise en forme, lint), lance les tests unitaires, audite les dépendances, construit, contrôle le budget de poids, lance les tests de bout en bout, puis publie le site sur GitHub Pages. Si une étape échoue, rien n'est publié. Une pull request passe les mêmes vérifications, sans rien publier. Le fichier `static/CNAME` relie le site au domaine `stationcomplete.org`.

## Sécurité

Dependabot propose chaque mardi les mises à jour des bibliothèques et des actions, avec un délai de 7 jours après leur publication. Il propose aussi les correctifs de sécurité dès qu'une faille est connue. Les mises à jour sans risque (correctifs de sécurité non majeurs, outils de développement) sont fusionnées automatiquement si toute la CI passe ; les autres attendent une relecture. CodeQL analyse le code et les workflows. Mode d'emploi : `docs/securite/robot-dependances.md`. Signaler une faille : `.github/SECURITY.md` (en privé, jamais dans un ticket public).

Chaque lundi, le workflow `.github/workflows/stations.yml` reconstruit l'index des gares de chaque pays activé (une tâche par pays : un pays en échec ne bloque pas les autres), l'enregistre dans le dépôt et relance la publication. Lancé à la main, il peut construire l'index d'un pays précis, même désactivé (champ « pays »).

## Documentation

- `docs/ux-spec.md` : spécification UX (écrans, quêtes, principes visuels)
- `docs/osm-tags-rapport.md` : modèle de données OpenStreetMap
- `docs/architecture.md` : architecture technique et plan en lots ; § 9.2 : traduction ; § 13 : organisation par pays et check-list « ajouter un pays »
- `docs/i18n/` : glossaire fr/en/de/it/es et guide des relecteurs
- `docs/pays/` : études par pays (Suisse)
- `docs/securite/` : robot de mise à jour des dépendances, alertes de sécurité

## Licences

- Code : [GPL-3.0-or-later](LICENSE)
- Données contribuées : © contributeurs OpenStreetMap, licence [ODbL](https://opendatacommons.org/licenses/odbl/)
- Photographies aériennes : IGN – BD ORTHO, Licence Ouverte 2.0
- Police : Atkinson Hyperlegible Next (SIL Open Font License)
