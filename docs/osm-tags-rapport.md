# stationcomplete : modèle de données OSM pour quais, voies et pancartes d'arrêt

_Rapport d'analyse du 4 novembre 2026. Périmètre : gares du réseau ferré français, MVP à 3 objets._

> **Sources et vérification.** Les pages du wiki OSM ont été lues en ligne. La page _OpenRailwayMap/Tagging in France_ est trop longue pour être lue en entier par l'outil web. Ses sections « Stops » et « Passenger stops » ont donc été lues dans la **sauvegarde wikitext de son auteur principal** (Noël Danjou), dépôt [noeldev/FrenchRailwaySignalling](https://github.com/noeldev/FrenchRailwaySignalling), commit du 3 novembre 2026, fichier `wiki/backup/OpenRailwayMap/Tagging_in_France.wiki`. La table des matières de la page en ligne correspond à cette sauvegarde (§ 18 « Arrêts voyageurs », 7 sous-sections).
> **Taginfo et Overpass étaient inaccessibles depuis l'environnement de recherche** : robots.txt et proxy refusés. Aucun nombre d'occurrences n'est donc cité. Le § 7 donne les requêtes pour les obtenir.

---

## 0. Synthèse en une page

| Objet                                                             | Géométrie                                                    | Tags clés                                                                                                                                   | Où va l'info saisie                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Quai (plateforme voyageurs)                                       | **way fermé / area** (ou multipolygone), sinon way linéaire  | `railway=platform` + `public_transport=platform` + `train=yes`                                                                              | `ref` = numéros des **bords**/voies desservis (ex. `ref=1;2`) ; `local_ref`/`name` selon les cas (controversé, § 1.4) |
| Bord de quai (optionnel mais recommandé pour relier quai et voie) | **way ouvert**, partageant des nœuds avec le contour du quai | `railway=platform_edge` + `ref=<n° de voie affiché>`                                                                                        | numéro de voie côté voyageur, 1 valeur                                                                                |
| Voie en gare                                                      | **way** `railway=rail` (découpé aux aiguilles)               | `railway:track_ref=<n°/lettre>`                                                                                                             | « Voie A », « 3 » → `railway:track_ref=A` / `3`                                                                       |
| Pancarte d'arrêt                                                  | **node sur le way de la voie**                               | `railway=signal` + `railway:signal:direction` + `railway:signal:position` + `railway:signal:stop=FR:passenger_stop` + sous-clé de catégorie | ex. `railway:signal:stop:highspeed=FR:TGV` + `…:for=multiple_unit`                                                    |

Trois pièges majeurs (détails au § 4) :

1. **Le schéma français des pancartes d'arrêt a été refondu en 2026.** Les anciennes valeurs `FR:ARRET_TT`, `FR:ARRET_V` et `FR:ARRET_TGV*` sont désormais _legacy_. Le rendu OpenRailwayMap-vector ne gère pas encore les nouvelles.
2. **Pour le numéro de voie, `ref`, `local_ref`, `name` et `railway:track_ref` se concurrencent.** Le wiki anglais et le wiki français ne définissent même pas `railway:track_ref` de la même façon.
3. **Le sens d'une pancarte (`railway:signal:direction`) se définit par rapport au sens de dessin du way OSM**, pas par rapport à la gare. L'appli doit faire ce calcul elle-même, sans le demander au contributeur.

---

## 1. Quais (plateformes voyageurs)

### 1.1 Géométrie

- Le wiki de `railway=platform` recommande de dessiner une **surface** : « Draw an area around the perimeter of the platform ». Un way central est toléré. Le tag n'est pas prévu sur les nodes. Avec une surface, ajouter `area=yes` si le tag l'exige. Source : [Tag:railway=platform](https://wiki.openstreetmap.org/Tag:railway=platform).
- `public_transport=platform` accepte node, way et area. Le wiki précise que l'area convient « when a more expansive size is allocated », par exemple dans les gares ferroviaires. Source : [Tag:public_transport=platform](https://wiki.openstreetmap.org/Tag:public_transport=platform).
- Le bord de quai `railway=platform_edge` est un **way ouvert**, parallèle à la voie, qui partage des nœuds avec le contour du quai ou appartient à son multipolygone. Ne pas cartographier comme bord les côtés non parallèles à une voie ni les tronçons où l'on ne peut pas monter (clôture, portes condamnées). Sources : [Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge), [FR:Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dplatform_edge).

### 1.2 Tags principaux

```
railway=platform
public_transport=platform
train=yes
ref=1;2                 ← numéros des bords / voies desservies (convention platform_edge)
```

- `public_transport=platform` est « Required » dans le schéma PTv2. `railway=platform` y est « Important » et conservé pour compatibilité. Source : [Tag:public_transport=platform](https://wiki.openstreetmap.org/Tag:public_transport=platform).
- Selon les pages `platform_edge`, le `ref` du quai liste les numéros de ses bords séparés par `;` (ex. `ref=5;6`). Si le quai a **sa propre numérotation**, on met ce numéro à la place (exemple polonais : `ref=2`). Sources : [Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge), [FR:Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dplatform_edge).
- OpenRailwayMap (rendu vectoriel) lit le `ref` du quai et le découpe sur `;` (`split_semicolon_to_sql_array(tags.ref)`). Il lit aussi `height`, `surface`, `wheelchair`, `tactile_paving`, `shelter`, `bench`, `lit`, `departures_board`, etc. Source : [OpenRailwayMap-vector, `import/openrailwaymap.lua`](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/import/openrailwaymap.lua), lu au commit du 1ᵉʳ novembre 2026.

### 1.3 Tags secondaires utiles

- Sur le quai : `name`, `local_ref`, `surface`, `wheelchair`, `tactile_paving`, `layer` (obligatoire si le quai est sous ou sur un autre objet), `shelter`, `bench`, `lit`. Sources : [Tag:railway=platform](https://wiki.openstreetmap.org/Tag:railway=platform), [Tag:public_transport=platform](https://wiki.openstreetmap.org/Tag:public_transport=platform).
- Sur le bord : `ref` (numéro du bord), `height` (en m au-dessus du rail), `tactile_paving`. Source : [Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge).

**Exemple : quai central desservant les voies 1 et 2**

```
# surface du quai (way fermé)
railway=platform
public_transport=platform
train=yes
ref=1;2
# bord côté voie 1 (way ouvert, nœuds partagés avec le contour)
railway=platform_edge
ref=1
height=0.55
# bord côté voie 2
railway=platform_edge
ref=2
```

### 1.4 « Quai A » ou « Voie 1 » : la controverse sur l'identifiant

- En France, l'affichage voyageur indique généralement la **voie** (« Voie 1 »), parfois aussi une lettre de **quai**. Deux schémas se contredisent :
  - **PTv2** ([Tag:public_transport=platform](https://wiki.openstreetmap.org/Tag:public_transport=platform)) : `ref` = référence « operator-wide or network-wide » ; « Platform numbers are given using `local_ref` ».
  - **`railway=platform`/`platform_edge`** : `ref` = numéros des bords/voies (`5;6`).
- Le wiki `local_ref` signale cet usage divergent : mettre une lettre de quai dans `ref` « peut violer » la proposition PTv2. Source : [Key:local_ref](https://wiki.openstreetmap.org/wiki/Key:local%20ref?uselang=de).
- Discussion talk-fr d'octobre 2021 lors de la cartographie de 180 gares Transilien par Carto'Cité, Jungle Bus et Adrien Pavie pour SNCF Transilien :
  - Antoine Riche tague les quais avec `ref=1` ou `name=Voie 1`, comme l'affichage en gare ([message](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104588.html)).
  - David Marchal juge incohérent d'utiliser `ref`/`name` sur les quais et `railway:track_ref` sur les voies ([message](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104586.html)).
  - Denis Helfer répond que `railway:track_ref` relève de l'**infrastructure** (SNCF Réseau), alors que `ref`/`name`/`local_ref` relèvent de l'**information voyageur**, et recommande `platform_edge` pour porter la desserte ([message](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104608.html)).
  - **Aucun consensus n'a été acté.**

**Recommandation pour stationcomplete (choix de conception, non normatif) :**

- `ref` du quai = liste des numéros de voie affichés (`1;2`), conformément aux pages `platform_edge` et au rendu ORM.
- Lettre ou nom de quai propre (« Quai A ») dans `local_ref=A`.
- Numéro de voie unitaire sur chaque `platform_edge` (`ref=1`).
- Ne **jamais** écraser un `ref`/`name` existant sans le montrer au contributeur.

---

## 2. Numéro local des voies en gare

### 2.1 Géométrie et tag

- `railway:track_ref` s'applique **uniquement aux ways** (statut « de facto »). Exemples du wiki anglais : `railway:track_ref=2` (« Main Track 2 »), `railway:track_ref=57B` (voie de faisceau). `ref` sur une voie désigne la **ligne**, pas la voie. Source : [Key:railway:track_ref](https://wiki.openstreetmap.org/Key:railway:track_ref).
- OpenRailwayMap lit `railway:track_ref` pour l'étiquette des voies (`track_ref = tags['railway:track_ref']`). Source : [OpenRailwayMap-vector `openrailwaymap.lua`](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/import/openrailwaymap.lua).

```
railway=rail
usage=main
railway:track_ref=A        ← « Voie A »
```

### 2.2 Différences entre wiki anglais et wiki français

- Wiki **anglais** : numéro de la voie « within a station, yard or other railway facility ». Source : [Key:railway:track_ref](https://wiki.openstreetmap.org/Key:railway:track_ref).
- Wiki **français** : `track_ref` = référence de la voie **au sein d'une ligne**, et `local_ref` = référence locale valable dans l'emprise d'une gare. Exemple : voie 2 de la ligne = « voie A » en gare (`local_ref=A`). Une voie peut avoir les deux. La page renvoie au référentiel des voies SNCF (data.sncf.com). Source : [FR:Key:railway:track_ref](https://wiki.openstreetmap.org/wiki/FR:Key:railway:track_ref).
- La page de discussion FR (2017) donne l'autre lecture : un numéro de voie ne vaut qu'en gare ; quand la voie 1 devient la voie A puis redevient la voie 1, il faut **découper le way** (souvent à un aiguillage) et changer `railway:track_ref`. Source : [FR talk:Key:railway:track_ref](https://wiki.openstreetmap.org/wiki/FR_talk:Key:railway:track_ref).

**Recommandation (choix de conception) :**

- Saisir le numéro **affiché en gare** dans `railway:track_ref` sur le tronçon à quai : c'est la clé lue par ORM et la définition anglaise, de référence.
- Proposer `local_ref` en mode avancé seulement, quand un `railway:track_ref` différent existe déjà (numérotation « de ligne »). Signaler alors le conflit au lieu de l'écraser.
- `ref` et `name` = « Voie 1 » sur un `railway=rail` sont des erreurs courantes selon David Marchal ([talk-fr](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104586.html)). Ne pas les produire. Les proposer en migration seulement avec confirmation.

### 2.3 Découpage du way

Si la voie n'a pas la même identité sur toute sa longueur, il faut découper le way, généralement à l'aiguillage. C'est une **modification de géométrie**, que StreetComplete s'interdit sauf exception (« no elements can be added or removed », géométrie non modifiable à part découper un way ou déplacer un nœud). Source : [StreetComplete QUEST_GUIDELINES.md](https://github.com/streetcomplete/StreetComplete/blob/master/QUEST_GUIDELINES.md). Pour le MVP, ne taguer que des ways **déjà** limités à la zone à quai. Sinon, créer une Note OSM.

---

## 3. Pancartes d'arrêt des trains de voyageurs

### 3.1 Distinguer la pancarte conducteur du repère de quai voyageur

- **Pancarte d'arrêt (conducteur)** : 2-3 caractères alphanumériques (TT, 10V, Z57 2, TGV 1…). Se cartographie en `railway=signal`.
- **Repère de quai (voyageur)** : plaque métallique portant **une lettre majuscule** (A, B… R, S…) qui situe les voitures. Se cartographie en `railway=platform_marker` + `ref=S` + `platform_edge:ref=D;E`. **Hors MVP**, mais à ne pas confondre. Le wiki insiste : la pancarte conducteur « n'est pas un repère de quai ! ». Sources : [FR:Tag:railway=platform_marker](https://wiki.openstreetmap.org/FR:Tag:railway=platform_marker), [FR:Projet du mois/repères de quai](https://wiki.openstreetmap.org/wiki/FR:Projet_du_mois/rep%C3%A8res_de_quai).
- **Position d'arrêt** `railway=stop` / `public_transport=stop_position` : nœud sur la voie, au point où s'arrête la cabine. Ce n'est pas un panneau. Il est « usually placed next to a platform », et le wiki en suggère deux, `direction=forward`/`backward`. Source : [Tag:railway=stop](https://wiki.openstreetmap.org/wiki/Tag:railway=stop?uselang=en).

### 3.2 Tags génériques de tout signal (France)

Extrait de [OpenRailwayMap/Tagging in France § General tags](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France) :

- `railway=signal`
- `railway:signal:direction=forward|backward|both` : sens **par rapport au sens du way**.
- `railway:signal:position=left|right|bridge|catenary_mast|ground|in_track|overhead`
- `railway:position:exact=365.913` : PK. **Inconnu du citoyen**, ne pas demander.
- `railway:signal:<catégorie>:ref=<idreseau>` : identifiant SNCF Réseau. **Inconnu du citoyen.**
- facultatifs : `ref` = texte de la **plaque de repérage**, quand elle existe ; `source=survey|image|SNCF - MM/AAAA`.
- `form` : `sign` (pancarte), `board` (tableau lumineux), `light`.

Règles génériques du wiki signaux :

- Le signal est un **nœud placé sur la voie**.
- `position` est le côté par rapport au sens du way.
- Suffixe `:backward` = sens inverse seulement ; `direction=both` si le signal est identique dans les deux sens.
- Si le signal est entre deux voies, celles-ci doivent avoir le même sens.

Source : [FR:Tag:railway=signal](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dsignal). La clé `railway:signal:stop` est « node only », requiert `railway=signal` et `railway:signal:direction`, statut de facto. Source : [Key:railway:signal:stop](https://wiki.openstreetmap.org/wiki/Key:railway:signal:stop).

### 3.3 Schéma français actuel des « Arrêts voyageurs » (2026)

Source : [OpenRailwayMap/Tagging in France § Passenger stops](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France), wikitext lu dans la [sauvegarde de l'auteur](https://github.com/noeldev/FrenchRailwaySignalling).

Principe :

- Valeur racine **commune** `railway:signal:stop=FR:passenger_stop`.
- Une **sous-clé par catégorie de train**, imbriquées : `any` > `conventional` > (`regional`, `suburban`) et `highspeed`. On tague la catégorie **la plus spécifique**.
- La forme est portée par la sous-clé : `railway:signal:stop:<cat>:form=sign`.

| Pancarte sur le terrain                          | Tags                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TT** (tête de train, tout train classique)     | `railway:signal:stop:conventional=FR:TT`                                                                                                                                                          |
| **TT EAS** (équipé agent seul)                   | `…:conventional=FR:TT` + `…:conventional:for=driver_only`                                                                                                                                         |
| **TTL** (train avec locomotive)                  | `…:conventional=FR:TT` + `…:conventional:for=locomotive`                                                                                                                                          |
| **5V, 10V, 5/6V** (nombre de véhicules)          | `…:conventional=FR:vehicle_number` + `…:conventional:for=vehicles` + `…:conventional:number=5` (ou `5;6`) ; optionnels `…:conventional:reversal=yes` (« 1/2 t »), `…:conventional:trainset=Z6400` |
| **L110, L220** (longueur de train)               | `railway:signal:stop:any=FR:train_length` + `…:any:length=220` ; optionnel `…:any:reversal=yes` (RBT)                                                                                             |
| **Z57 1 / 1-2 / 2 / 2-3 / 3** (Régio 2N : US/UM) | `railway:signal:stop:regional=FR:Z57` + `…:regional:for=single_unit                                                                                                                               | multiple_unit`;`…:regional:unit_number=3`ou`2;3`(2 par défaut) ;`…:regional:reversal=yes`        |
| **Z50-1 / Z50-2** (Francilien)                   | `railway:signal:stop:suburban=FR:Z50` + `…:suburban:for=single_unit                                                                                                                               | multiple_unit`                                                                                   |
| **Train long / Train court / Tous trains** (RER) | `railway:signal:stop:suburban=FR:long_train                                                                                                                                                       | FR:short_train                                                                                   | FR:all_trains`; petites pancartes **TL/TC** entre les rails :`railway:signal:position=in_track`; marquage au sol :`position=ground`;`…:suburban:caption=` facultatif |
| **UFR** (porte fauteuil roulant)                 | `railway:signal:stop:accessibility=FR:UFR`                                                                                                                                                        |
| **TGV 1 / TGV 2 / TGV 1-2 / TGV 2D / TGV 1 RBT** | `railway:signal:stop:highspeed=FR:TGV` + `…:highspeed:for=single_unit                                                                                                                             | multiple_unit`(absent pour 1-2) ;`…:highspeed:type=duplex`(2D) ;`…:highspeed:reversal=yes` (RBT) |

Toutes ces lignes s'ajoutent à `railway=signal`, `railway:signal:stop=FR:passenger_stop` et `railway:signal:stop:<cat>:form=sign`.

Les pancartes « US » et « UM » du cahier des charges correspondent à `for=single_unit` / `for=multiple_unit` des familles Z57, Z50 et TGV.

À ne pas confondre :

- `railway:signal:stop=FR:ARRET` : arrêt **réglementaire** qui exige un ordre verbal. Les variantes « TGV A et ETR » relèvent aussi de `FR:ARRET` et non de `passenger_stop`.
- `FR:STOP` et le jalon d'arrêt `railway:signal:minor=FR:stop_marker`.

Même source.

**Exemple complet : pancarte « TGV 2 » à droite de la voie, lue dans le sens du way**

```
railway=signal
railway:signal:direction=forward
railway:signal:position=right
railway:signal:stop=FR:passenger_stop
railway:signal:stop:highspeed=FR:TGV
railway:signal:stop:highspeed:form=sign
railway:signal:stop:highspeed:for=multiple_unit
source=survey
```

**Exemple : pancarte « 10V » à gauche, lue dans le sens inverse du way**

```
railway=signal
railway:signal:direction=backward
railway:signal:position=left
railway:signal:stop=FR:passenger_stop
railway:signal:stop:conventional=FR:vehicle_number
railway:signal:stop:conventional:form=sign
railway:signal:stop:conventional:for=vehicles
railway:signal:stop:conventional:number=10
```

### 3.4 Anciennes valeurs encore présentes dans les données

- Les règles de validation JOSM/Osmose publiées avec le schéma convertissent `FR:ARRET_TT`, `FR:ARRET_TTL`, `FR:ARRET_TT_EAS`, `FR:ARRET_V` (+ `caption`, ex. `Z57 1`) et `FR:ARRET_TGV1`… vers le nouveau schéma. Ex. `FR:ARRET_TT` → `FR:passenger_stop` + `railway:signal:stop:conventional=FR:TT`. Source : [validator/rules.json](https://github.com/noeldev/FrenchRailwaySignalling/blob/main/validator/rules.json). L'ancienne version FR du wiki, conservée dans la même sauvegarde, utilisait encore `FR:ARRET_TT`, `FR:ARRET_V` + `caption`, `FR:ARRET_TGV` + `:for=single_unit` ([wiki/backup/FR](https://github.com/noeldev/FrenchRailwaySignalling/tree/main/wiki/backup/FR/OpenRailwayMap)).
- La page [FR:Tag:railway=platform_marker](https://wiki.openstreetmap.org/FR:Tag:railway=platform_marker) montre encore un exemple ancien style (`railway:signal:stop=FR:Z57-3`, `railway:signal:form=sign`).
- **Le rendu OpenRailwayMap-vector (commit du 1ᵉʳ novembre 2026) ne connaît que les anciennes valeurs** (`FR:ARRET_TT`, `FR:ARRET_TTL`, `FR:ARRET_TT_EAS`, `FR:ARRET_V`, `FR:ARRET_TGV1`, `FR:ARRET_TGV2`, `FR:ARRET_TGV1-2`). Aucune occurrence de `passenger_stop` n'y figure. Source : [features/signals_railway_signals.yaml](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/features/signals_railway_signals.yaml).
- **Conséquence** : les pancartes saisies au nouveau schéma ne s'afficheront pas encore sur openrailwaymap.org. Il faut le dire aux contributeurs et suivre l'évolution, éventuellement par une PR vers ORM-vector. **Ne pas** écrire les deux schémas à la fois.

### 3.5 Rattacher une pancarte à une voie

- **Sur le way de la voie**, en nœud membre du way : c'est la convention des signaux ORM ([FR:Tag:railway=signal](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dsignal)). Une pancarte posée sur le quai, à côté, se cartographie donc **sur la voie**, au droit du panneau, avec `position=left|right`. Il n'existe pas de relation pancarte → quai.
- `direction` et `position` se calculent **à partir du sens de dessin du way**. L'appli doit afficher la voie et sa flèche, demander « dans quel sens roulent les trains qui lisent ce panneau ? », puis déduire `forward`/`backward` et `left`/`right`. Ne jamais faire saisir « forward » au contributeur.
- Si un way est inversé plus tard par un autre contributeur, les `direction`/`position` deviennent faux. JOSM corrige `forward`/`backward` à l'inversion, mais pas tous les éditeurs. C'est un piège connu des tags directionnels, non documenté spécifiquement ici : **à vérifier**.
- Plusieurs pancartes sur un même poteau (ex. « TGV 1 » + « 10V ») : le schéma par sous-clé de catégorie permet en principe de cumuler des catégories **différentes** sur un même nœud. Deux pancartes de la **même** catégorie (5V et 10V) exigent deux nœuds. Ce point est une **inférence** : le wiki ne le dit pas explicitement. Pour le MVP, prévoir **un nœud par pancarte**, légèrement décalés le long de la voie.

### 3.6 Pancartes et imagerie

Une pancarte ne se voit pas sur une orthophoto : elle se relève **sur le terrain**, depuis le quai (`source=survey`). L'imagerie sert à placer le nœud sur la bonne voie et au bon endroit. Positionner le nœud au droit du panneau ; le PK n'est pas requis.

---

## 4. Relier quais, voies et gare

1. **Quai ↔ voie, sans relation** : `platform_edge` (way sur le contour du quai, `ref` = n° de voie), parallèle et contigu au `railway=rail` qui porte `railway:track_ref` de même valeur. Le lien est **sémantique et géométrique** : aucune relation OSM standard ne lie un bord de quai à un way de voie. Sources : [Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge), [Key:railway:track_ref](https://wiki.openstreetmap.org/Key:railway:track_ref).
2. **Relation `stop_area`** :
   - Tags `type=public_transport` + `public_transport=stop_area`.
   - Rôles : `platform` pour les `public_transport=platform`, `stop` pour les `public_transport=stop_position`, rôle vide pour le `public_transport=station`, les entrées et les équipements.
   - Pour les grandes plateformes multimodales, hiérarchie via `stop_area_group`.
   - Source : [Tag:public_transport=stop_area](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dstop_area). FR:Tag:railway=station la recommande pour les gares grandes et complexes ([FR:Tag:railway=station](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dstation)).
   - MVP : **lire** la stop_area pour lister les quais d'une gare. Si un quai existant n'y figure pas, signaler, sans modifier automatiquement les relations.
3. **Positions d'arrêt** (`railway=stop` / `public_transport=stop_position`) sur la voie, à côté du quai, et membres `stop` de la stop_area. À ne pas confondre avec la pancarte : la position d'arrêt est le point d'arrêt abstrait, la pancarte est l'objet physique. Source : [Tag:railway=stop](https://wiki.openstreetmap.org/wiki/Tag:railway=stop?uselang=en).

---

## 5. Pièges, ambiguïtés et points controversés

| #   | Sujet                                  | Détail                                                                                                                                                                           | Sources                                                                                                                                                                                                                                                |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `ref` du quai                          | Numéros de voie (`1;2`) selon `platform_edge`, mais référence réseau selon PTv2, où le n° de quai va dans `local_ref`                                                            | [platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge), [public_transport=platform](https://wiki.openstreetmap.org/Tag:public_transport=platform), [local_ref](https://wiki.openstreetmap.org/wiki/Key:local%20ref?uselang=de) |
| 2   | Définition de `railway:track_ref`      | « en gare » (EN) contre « dans la ligne », avec `local_ref` en gare (FR)                                                                                                         | [EN](https://wiki.openstreetmap.org/Key:railway:track_ref), [FR](https://wiki.openstreetmap.org/wiki/FR:Key:railway:track_ref)                                                                                                                         |
| 3   | Voies taguées `ref`/`name=Voie 1`      | Erreur fréquente, à ne pas reproduire                                                                                                                                            | [talk-fr 2021](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104586.html)                                                                                                                                                             |
| 4   | Infrastructure ou information voyageur | Numérotation SNCF Réseau ≠ affichage en gare ; plusieurs numérotations possibles dans une même gare                                                                              | [talk-fr 2021](https://lists.openstreetmap.org/pipermail/talk-fr/2021-October/104608.html)                                                                                                                                                             |
| 5   | Refonte 2026 des pancartes             | Anciennes valeurs `FR:ARRET_*` encore en base ; rendu ORM en retard sur le wiki                                                                                                  | § 3.4                                                                                                                                                                                                                                                  |
| 6   | Sens des signaux                       | Relatif au sens du way, fragile lors d'une inversion                                                                                                                             | [FR:Tag:railway=signal](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dsignal)                                                                                                                                                                   |
| 7   | Pancarte ou repère de quai             | Lettre seule = `platform_marker` ; texte TT/10V/TGV = `signal`                                                                                                                   | [FR:platform_marker](https://wiki.openstreetmap.org/FR:Tag:railway=platform_marker)                                                                                                                                                                    |
| 8   | Pancarte ou `railway=stop`             | Objet physique contre position abstraite                                                                                                                                         | [railway=stop](https://wiki.openstreetmap.org/wiki/Tag:railway=stop?uselang=en)                                                                                                                                                                        |
| 9   | Découpage de voies                     | Nécessaire si l'identité change, mais c'est une modification de géométrie (hors périmètre d'une appli de type StreetComplete)                                                    | [FR talk track_ref](https://wiki.openstreetmap.org/wiki/FR_talk:Key:railway:track_ref), [QUEST_GUIDELINES](https://github.com/streetcomplete/StreetComplete/blob/master/QUEST_GUIDELINES.md)                                                           |
| 10  | Sécurité et accès                      | Les informations doivent se relever « on foot » depuis un lieu public. Pour une pancarte, c'est depuis le quai : **jamais** depuis les voies ni en dépassant les limites de quai | [QUEST_GUIDELINES](https://github.com/streetcomplete/StreetComplete/blob/master/QUEST_GUIDELINES.md)                                                                                                                                                   |
| 11  | Données SNCF                           | Le jeu « signalisation permanente » SNCF, utilisé pour `source=SNCF - MM/AAAA`, n'est plus disponible depuis environ mi-2024                                                     | [Talk:OpenRailwayMap/Tagging in France](https://wiki.openstreetmap.org/wiki/Talk:OpenRailwayMap/Tagging_in_France)                                                                                                                                     |

---

## 6. Règles OSM applicables à l'appli

### 6.1 Changesets

- Tags recommandés :
  - `comment`, rédigé par un humain et non automatique ;
  - `created_by` (logiciel) ; `source` ; `imagery_used` ; `locale` ; `hashtags` (séparés par `;`) ; `host` ;
  - `review_requested=yes` si besoin : d'après [Key:review_requested](https://wiki.openstreetmap.org/wiki/Key:review_requested) (lu le 13/11/2026), « changeset tag; indicates that the user would like someone to review this changeset », seule valeur documentée `yes`, posée par une case cochée par le contributeur à l'enregistrement (iD, JOSM, Rapid : « I would like someone to review my edits ») ; OSMCha signale ces changesets (filtre « Reason for flagging » = « Review requested »). La page prévient que ces demandes sont « followed quite rarely ». stationcomplete l'utilise depuis QA-3 (case de E8, cochée d'office pour les suppressions, points partagés déplacés, déclarations sur l'honneur et avertissements vérifiés ; `docs/architecture.md` § 4.5.2).
- Limites :
  - 10 000 éléments par changeset ;
  - fermeture automatique après 1 h d'inactivité, ouverture de 24 h au maximum ;
  - un changeset fermé n'est plus modifiable ;
  - garder les changesets **locaux** : une ville, une seule zone.
- Source : [Changeset](https://wiki.openstreetmap.org/wiki/Changeset).

Modèle StreetComplete, lu dans le code :

- tags `comment` (propre au type de quête), `created_by` (user-agent `StreetComplete x.y`), `locale`, `StreetComplete:quest_type=<nom>`, `source` (toujours `survey`) ;
- changeset réutilisé par type de quête et par source, refermé et recréé si la nouvelle modification est à plus de **5 km** de la précédente.

Sources : [OpenChangesetsManager.kt](https://github.com/streetcomplete/StreetComplete/blob/master/app/src/commonMain/kotlin/de/westnordost/streetcomplete/data/osm/edits/upload/changesets/OpenChangesetsManager.kt), [ElementEdit.kt](https://github.com/streetcomplete/StreetComplete/blob/master/app/src/commonMain/kotlin/de/westnordost/streetcomplete/data/osm/edits/ElementEdit.kt), [ApplicationConstants.kt](https://github.com/streetcomplete/StreetComplete/blob/master/app/src/commonMain/kotlin/de/westnordost/streetcomplete/ApplicationConstants.kt).

**Proposition pour stationcomplete :**

```
created_by=stationcomplete 0.1.0
comment=Ajout du numéro de voie (Gare de Xxx)      ← propre au type de saisie, éditable
source=survey
imagery_used=BDOrtho IGN                           ← seulement si l'imagerie a été affichée
locale=fr-FR
stationcomplete:edit_type=track_ref                   ← calqué sur StreetComplete:quest_type
hashtags=#stationcomplete
```

Faire un changeset par gare et par type de saisie.

### 6.2 Modification automatisée ou modification humaine

- Le Code de conduite des modifications automatisées couvre les modifications faites « without review individually by the person controlling the edits » : bots, imports, rechercher-remplacer, Overpass en masse.
- Pour ces modifications, il exige :
  - une page wiki dédiée et une entrée dans le journal ;
  - une discussion préalable sur le forum ;
  - `mechanical=yes` ou `bot=yes`, et une `description` pointant vers la documentation ;
  - de respecter les demandes d'opt-out.
- Source : [Automated Edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct).
- Une appli où **chaque modification est saisie et validée par un humain sur le terrain**, sur le modèle de StreetComplete, sort de ce périmètre. **Toute migration en masse** est, elle, une modification automatisée soumise au code : par exemple convertir les anciennes valeurs `FR:ARRET_*`, ou recopier les `ref` des quais vers les voies. Ne pas en faire dans l'appli.
- Principes StreetComplete à reprendre :
  - une seule question par écran ;
  - **uniquement des tags établis** (« Establishing tags must remain a community process ») ;
  - pas de question sans réponse possible ;
  - aucune connaissance OSM requise ;
  - réponse rapide ;
  - information accessible à pied depuis l'espace public ;
  - ne pas demander sur le terrain ce qui se fait mieux à distance.
  - Source : [QUEST_GUIDELINES.md](https://github.com/streetcomplete/StreetComplete/blob/master/QUEST_GUIDELINES.md).
  - Le schéma `FR:passenger_stop` est documenté mais **très récent**. Il vaut mieux l'annoncer sur le forum OSM France avant le lancement.

### 6.3 Imagerie en France

- **BD ORTHO IGN : autorisée.**
  - Une convention OSM France–IGN de 2016 en permettait déjà la consultation.
  - « Depuis le 1er janvier 2021, la BD Ortho IGN est sous Licence Ouverte 2.0 », comme la BD TOPO et les autres données IGN ouvertes, **sauf le SCAN 25**.
  - C'est le fond par défaut d'iD (≥ 2.70), qui ajoute automatiquement `imagery_used=BDOrtho IGN`.
  - Tuiles TMS via le proxy d'OSM France : `https://proxy-ign.openstreetmap.fr/94GjiyqD/bdortho/{z}/{x}/{y}.jpg`.
  - Mention de source demandée : `source=BDOrtho IGN 20xx`.
  - Source : [FR:Sources de données potentielles/France](https://wiki.openstreetmap.org/wiki/FR:Sources_de_donn%C3%A9es_potentielles/France).
- **Interdits** : SCAN 25 IGN (même source), ainsi que Google, Apple et toute imagerie sans autorisation explicite pour OSM.
- Pour afficher la BD ORTHO dans la PWA, on peut aussi passer par le WMTS de la Géoplateforme IGN (couche `ORTHOIMAGERY.ORTHOPHOTOS`). La page officielle redirige vers cartes.gouv.fr et n'a pas pu être lue. L'exemple IGN consulté ([leaflet-WMTS](https://ignf.github.io/evolution-apigeoportail/leaflet/leaflet-WMTS.html)) date de l'ancienne API à clé. **Vérifier les conditions actuelles d'accès sans clé avant usage.**

### 6.4 API OSM v0.6 et OAuth 2.0

- **Authentification** :
  - OSM n'accepte plus que **OAuth 2.0** ; OAuth 1.0a et Basic Auth ont été arrêtés en juin 2024 ([API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6)) ;
  - flux _Authorization Code avec PKCE_ pour une PWA (client **non confidentiel**, secret facultatif) ;
  - endpoints `https://www.openstreetmap.org/oauth2/authorize` et `/oauth2/token` ;
  - scopes utiles : `write_api` (inclut les commentaires de changeset), `read_prefs`, éventuellement `write_notes` ;
  - redirect URI obligatoirement en https (sauf `http://127.0.0.1`) ;
  - enregistrement sur `https://www.openstreetmap.org/oauth2/applications/new` ;
  - tokens actuellement sans expiration, mais gérer l'erreur d'expiration ;
  - serveur de dev séparé : `master.apis.dev.openstreetmap.org`, avec ses propres comptes et clients.
  - Source : [OAuth](https://wiki.openstreetmap.org/wiki/OAuth).
- **Écriture** :
  - `PUT /api/0.6/changeset/create`, puis upload **osmChange** transactionnel `POST /api/0.6/changeset/#id/upload` (tout ou rien), puis `PUT /api/0.6/changeset/#id/close` ;
  - chaque élément modifié doit porter la `version` téléchargée ;
  - un PUT d'élément exige l'élément **complet** (tous les tags, nœuds et membres).
- **Erreurs à gérer** :
  - **409** : version obsolète ou changeset fermé. Recharger, refaire le diff de tags, redemander confirmation.
  - **412** : nœud référencé manquant.
  - **429** : limitation de débit.
- **Lecture** :
  - `GET /api/0.6/map?bbox=` (0,25 degré² au maximum, 50 000 nœuds au maximum) ;
  - `/node/#id/ways`, `/[type]/#id/relations`, `/way/#id/full` ;
  - JSON disponible en lecture avec `Accept: application/json`, mais l'**écriture se fait en XML uniquement**.
  - Source : [API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6).
- **Ajouter un nœud de pancarte sur une voie** = créer un node **et** modifier le way pour l'insérer dans sa liste de nœuds, dans un seul osmChange. C'est la seule opération du MVP qui touche à la géométrie.

---

## 7. Mesurer l'usage réel (taginfo et Overpass, à exécuter)

Les chiffres taginfo n'ont pas pu être récupérés ici. Pour les obtenir :

- taginfo mondial : `https://taginfo.openstreetmap.org/keys/railway:track_ref`, `…/keys/railway:signal:stop#values`, `…/tags/railway=platform_edge`.
- taginfo France : `https://taginfo.geofabrik.de/europe:france/keys/railway:signal:stop#values`.
- Le projet taginfo des presets français se trouve sur [noeldev.github.io/FrenchRailwaySignalling/taginfo.json](https://noeldev.github.io/FrenchRailwaySignalling/taginfo.json), d'après le README du dépôt.
- Overpass, France, comptage par valeur :

```
[out:json][timeout:180];
area["ISO3166-1"="FR"][admin_level=2]->.fr;
(
  node["railway:signal:stop"](area.fr);
)->.s;
.s out count;
node.s["railway:signal:stop"~"^FR:ARRET_"](area.fr); out count;     // legacy
node.s["railway:signal:stop"="FR:passenger_stop"](area.fr); out count; // nouveau schéma
way["railway"="rail"]["railway:track_ref"](area.fr); out count;
way["railway"="rail"]["local_ref"](area.fr); out count;
way["railway"="rail"]["name"~"^[Vv]oie"](area.fr); out count;        // erreurs probables
nwr["railway"="platform"](area.fr); out count;
nwr["railway"="platform"]["ref"](area.fr); out count;
nwr["railway"="platform"]["local_ref"](area.fr); out count;
way["railway"="platform_edge"](area.fr); out count;
```

---

## 8. Champs de formulaire pour l'appli

Champs communs (invisibles) : identifiant OSM, `version`, géométrie de contexte, sens du way. Le changeset est géré par l'appli (§ 6.1).

### 8.1 Quai (édition d'un quai existant, `railway=platform` ou `public_transport=platform`)

| Champ UI                                                   | Tag                                                          | Type / valeurs                                                            | Notes                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| « Numéros des voies le long de ce quai »                   | `ref`                                                        | liste de 1 à 4 jetons alphanum. (`1`, `2`, `A`, `3bis`), sérialisée `1;2` | Pré-rempli avec les `railway:track_ref` des voies adjacentes, s'ils existent |
| « Ce quai a-t-il une lettre/un nom propre ? » (facultatif) | `local_ref`                                                  | texte court (`A`, `B`)                                                    | Saisie libre, majuscules                                                     |
| Nom affiché (avancé)                                       | `name`                                                       | texte                                                                     | Rarement utile ; ne pas proposer « Voie X »                                  |
| Tags complétés si absents (avec confirmation)              | `public_transport=platform`, `railway=platform`, `train=yes` | fixe                                                                      | Uniquement ajoutés, jamais supprimés                                         |
| Bouton « Je ne sais pas / pas visible »                    | aucun tag                                                    | crée une Note OSM                                                         | Cas limite (menu « Euh… » de StreetComplete)                                 |

Option bords de quai (v2) : si des `railway=platform_edge` existent, demander pour chacun « numéro de voie de ce côté ? » → `ref` (1 valeur), `height` (liste : `0.38`, `0.55`, `0.76`, `0.92`, autre) en option.

### 8.2 Voie en gare (`railway=rail` existant, tronçon le long d'un quai)

| Champ UI                                           | Tag                                                          | Type / valeurs                                                                   | Notes                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| « Numéro ou lettre de cette voie affiché en gare » | `railway:track_ref`                                          | alphanum., 1 à 5 caractères (`1`, `A`, `2bis`, `57B`) ; ne pas préfixer « Voie » | Normaliser : retirer « Voie », « V » en tête                                                     |
| Conflit détecté (lecture seule)                    | `railway:track_ref` / `local_ref` / `ref` / `name` existants | affichage                                                                        | Si une valeur différente existe : proposer `local_ref` ou une Note, ne jamais écraser en silence |
| « Le numéro change-t-il le long de ce tronçon ? »  | aucun tag                                                    | oui → Note OSM                                                                   | Évite les découpages de géométrie dans le MVP                                                    |

### 8.3 Pancarte d'arrêt (création d'un node sur la voie ou édition d'un node existant)

Étapes :

1. **Placement** : taper sur la voie, au droit du panneau. Le nœud est inséré dans le way. Si un nœud `railway=signal` avec `railway:signal:stop` existe à moins de 10 m environ, proposer de l'éditer plutôt que d'en créer un.
2. **Sens** : « Les trains qui lisent ce panneau vont vers → / ← » (flèche sur la carte) → `railway:signal:direction=forward|backward`, calculé d'après le sens du way.
3. **Côté** : « Le panneau est à gauche / à droite de la voie, ou entre les rails / au sol » (du point de vue du conducteur) → `railway:signal:position=left|right|in_track|ground`, converti vers le sens du way si `backward` (gauche ↔ droite).
4. **Type** : grille de vignettes SVG des pancartes, reprises des fichiers CC BY-SA du wiki :

| Vignette                         | Tags écrits                                                       | Champ complémentaire                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TT                               | `…:conventional=FR:TT`                                            | variante : aucune / EAS → `:for=driver_only` / TTL → `:for=locomotive`                                                                                                                              |
| nV (5V, 10V…)                    | `…:conventional=FR:vehicle_number`, `…:conventional:for=vehicles` | nombre(s) → `:number=10` ou `5;6` ; case « 1/2 t » → `:reversal=yes` ; série (facultatif) → `:trainset=Z6400`                                                                                       |
| L… (L110, L220)                  | `…:any=FR:train_length`                                           | longueur en m → `:length` ; case « RBT » → `:reversal=yes`                                                                                                                                          |
| Z57 …                            | `…:regional=FR:Z57`                                               | composition : 1 (US) → `:for=single_unit` / 2 → `:for=multiple_unit` / 3 → `:for=multiple_unit` + `:unit_number=3` / 1-2 → aucun `for` / 2-3 → `multiple_unit` + `unit_number=2;3` ; case « 1/2 t » |
| Z50-1 / Z50-2                    | `…:suburban=FR:Z50`                                               | `:for=single_unit                                                                                                                                                                                   | multiple_unit`; « 1/2 » →`:reversal=yes` |
| Train long / court / Tous trains | `…:suburban=FR:long_train                                         | FR:short_train                                                                                                                                                                                      | FR:all_trains`                           | petit modèle entre rails → `position=in_track` (TL/TC), au sol → `position=ground` |
| UFR                              | `…:accessibility=FR:UFR`                                          | aucun                                                                                                                                                                                               |
| TGV 1 / 2 / 1-2 / 2D / 1 RBT     | `…:highspeed=FR:TGV`                                              | `:for=single_unit` (1), `multiple_unit` (2, 2D), aucun (1-2) ; 2D → `:type=duplex` ; RBT → `:reversal=yes`                                                                                          |
| Autre / illisible                | aucun signal créé                                                 | Note OSM avec photo, hébergée hors OSM                                                                                                                                                              |

Tags toujours écrits : `railway=signal`, `railway:signal:stop=FR:passenger_stop`, `railway:signal:stop:<cat>:form=sign`, `source=survey` sur l'objet. `source` peut aussi rester au seul niveau du changeset : choix à arbitrer, StreetComplete ne le met que sur le changeset.

5. **Plaque de repérage** (facultatif) : « Un numéro est-il inscrit sur une petite plaque ? » → `ref`.
6. **Pancarte existante en ancien schéma** (`FR:ARRET_TT`…) : afficher « ancien format ». Proposer la conversion **uniquement** si le contributeur confirme sur place que la pancarte existe toujours. La table de correspondance est celle de [rules.json](https://github.com/noeldev/FrenchRailwaySignalling/blob/main/validator/rules.json).

À ne **pas** demander : `railway:position:exact` (PK), `railway:signal:…:ref` (idreseau SNCF Réseau), invisibles pour un citoyen.

---

## 9. Points à valider avant développement

1. Le choix `ref` / `local_ref` pour les quais (§ 1.4) : en discuter sur le forum OSM France (catégorie France) ou la liste talk-fr.
2. Le nouveau schéma `FR:passenger_stop` : vérifier son adoption auprès de l'auteur (Noeld) et la feuille de route du rendu ORM-vector.
3. Les chiffres réels via taginfo et Overpass (§ 7).
4. Les conditions d'accès au WMTS Géoplateforme pour un fond BD ORTHO intégré à la PWA.

---

## 10. Équipements utiles aux voyageurs (lot « Équipements », 11 novembre 2026)

_Demande de Loïc, validée. Pages du wiki lues en ligne le 11 novembre 2026. **Taginfo était de nouveau inaccessible** (proxy refusé) : aucun nombre d'occurrences n'est cité ; le statut retenu est celui affiché par le wiki._

Règles appliquées à tout le lot :

- **OSM ne garde que le durable.** Aucun état temporaire n'est écrit (écran éteint, ascenseur en panne, distributeur hors service). « Oui » veut dire « l'équipement existe ». Un service de signalement des pannes sera étudié à part, hors OSM.
- **Tout se relève sur place** (règle `canSurvey`), sauf ce qui se voit sans ambiguïté sur la photo aérienne. Rien de ce lot ne l'est, **pas même l'abri** : sur la BD ORTHO, un abri de quai se confond avec un auvent, un local technique, un mât d'éclairage ou le toit de la gare, et la photo peut dater de plusieurs années. L'abri se relève donc sur place, comme le reste.
- **« Je ne sais pas » ne change rien** : aucun tag écrit, aucun tag retiré.
- `check_date=AAAA-MM-JJ` est posé quand l'utilisateur enregistre sur place (comme pour les numéros).

### 10.1 Caractéristiques d'un quai (étape 1)

| Question (fiche E7)                 | Tag écrit sur le quai                  | Statut wiki, source                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hauteur du quai au-dessus du rail   | `height=0.55` (mètres, point décimal)  | Documenté sur [Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/Tag:railway=platform_edge) et [FR:Tag:railway=platform_edge](https://wiki.openstreetmap.org/wiki/FR:Tag:railway%3Dplatform_edge) : « hauteur en mètres au-dessus des rails ». **Non documenté sur les pages du quai** (voir ci-dessous) |
| Écrans d'affichage des trains       | `passenger_information_display=yes/no` | de facto, [Key:passenger_information_display](https://wiki.openstreetmap.org/wiki/Key:passenger_information_display) ; listé sur [Tag:public_transport=platform](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dplatform)                                                                                 |
| Abri pour attendre                  | `shelter=yes/no`                       | [Tag:public_transport=platform](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dplatform) : « s'il y a un abri qui n'est pas cartographié à part avec `amenity=shelter` »                                                                                                                                  |
| Bandes podotactiles le long du bord | `tactile_paving=yes/no`                | approuvé, [Key:tactile_paving](https://wiki.openstreetmap.org/Key:tactile_paving) ; listé sur la page du quai                                                                                                                                                                                                         |
| Bancs                               | `bench=yes/no`                         | [Tag:public_transport=platform](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dplatform) : « s'il y a un banc qui n'est pas cartographié à part avec `amenity=bench` »                                                                                                                                    |

**Hauteur : convention retenue et réserve.** Le wiki ne documente `height` que sur le **bord de quai** (`railway=platform_edge`, mesuré au-dessus des rails). Sur la surface du quai, `height` est employé en pratique (par exemple à Ambérieu-en-Bugey : `height=0,55`, avec une virgule non standard) et un [fil du forum](https://community.openstreetmap.org/t/tram-railway-platform-with-different-heights-how-to-map-height-tag-or-split-up/129349) (2025-2026) recommande de porter la hauteur sur le quai entier et le détail sur `platform_edge`, sans consensus pour les quais à plusieurs hauteurs. L'appli écrit donc `height` **sur le quai** (même objet que `ref`), en mètres au-dessus du rail, avec un point décimal. Une hauteur déjà portée par un bord de quai relié (nœuds partagés) compte comme connue. **Point à valider** sur le forum OSM France avant la mise en production : faut-il aussi l'écrire sur les `platform_edge` ? (pas fait : un quai central a deux bords, parfois de hauteurs différentes). Valeurs proposées par pays (`countries.ts`) : France 0,55 / 0,76 / 0,92 m ; Suisse 0,55 m ; « Autre » accepte 0,10 à 1,50 m (« 55 » ou « 55 cm » sont lus 0,55 m) ; une valeur existante écrite avec une virgule est réécrite avec un point quand l'utilisateur confirme.

**Écrans : pourquoi `passenger_information_display` seul.** La page [Key:departures_board](https://wiki.openstreetmap.org/wiki/Key:departures_board) (de facto) dit que `passenger_information_display=yes/no` « est un tag plus largement utilisé pour dire si un quai a un affichage dynamique » et que les deux sont valides ; la [proposition de 2022](https://wiki.openstreetmap.org/wiki/Proposal:Deprecate_departures_board=realtime) de déprécier `departures_board=realtime` a été rejetée. La question posée (oui/non, « écrans ») correspond exactement à `passenger_information_display` ; écrire aussi `departures_board=realtime` serait redondant. Lecture : `departures_board=realtime` ou `delay` vaut « oui » ; `departures_board=no` vaut « non » ; `timetable` (horaires imprimés) et `yes` (sans précision) ne disent rien des écrans. L'appli n'écrit jamais `departures_board` ; si l'utilisateur répond « Non » alors que `departures_board=realtime|delay` est présent, cette valeur, contredite par le relevé, est retirée.

**Écarté : `tactile_paving=partial`.** Statut « in use » seulement ([Tag:tactile_paving=partial](https://wiki.openstreetmap.org/Tag:tactile_paving=partial)) ; la page de la clé le définit comme « une version particulière de `incorrect` », et, sur un escalier, comme « bandes en haut seulement ». Son sens sur un quai n'est pas établi : seules `yes` et `no` sont proposées.

**Déjà connu, donc pas demandé (quête Q8) :** valeur sur chaque partie concernée du quai ; hauteur ou bandes sur un bord de quai relié ; abri (`amenity=shelter`) ou banc (`amenity=bench`) cartographié à part à l'intérieur du quai.

**Quai en plusieurs parties** (Paris-Saint-Lazare) : une réponse s'écrit sur toutes les parties, dans la même saisie, **sauf l'abri**, qui ne s'écrit que sur les parties à l'air libre (une partie couverte par la dalle n'a ni abri ni absence d'abri au sens du wiki ; `covered=yes` ou la couche négative le disent déjà). Un quai entièrement couvert n'a pas de question « abri ».

### 10.2 Équipements ponctuels (étape 2)

| Équipement              | Tags écrits                                                                                                                | Statut wiki, source                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ascenseur               | `highway=elevator`, `level=*` (niveaux desservis, « -1;0 »), `wheelchair=yes/no`, `check_date`                             | de facto, [Tag:highway=elevator](https://wiki.openstreetmap.org/wiki/Tag:highway%3Delevator) (« level=-1;0;1;2 » pour un ascenseur du sous-sol au 2e étage) ; [FR:Gares ferroviaires](https://wiki.openstreetmap.org/wiki/FR:Railway_stations) |
| Distributeur de billets | `amenity=vending_machine`, `vending=public_transport_tickets`, `operator=*` (facultatif), `level=*` si connu, `check_date` | approuvé, [Tag:vending=public_transport_tickets](https://wiki.openstreetmap.org/wiki/Tag:vending%3Dpublic_transport_tickets) ; [FR:Gares ferroviaires](https://wiki.openstreetmap.org/wiki/FR:Railway_stations) (« Automates »)                |

**Nœud isolé : accepté pour un ascenseur.** La page [Tag:highway=elevator](https://wiki.openstreetmap.org/wiki/Tag:highway%3Delevator) dit seulement « ajoutez un nœud à l'emplacement de l'ascenseur » ; elle n'exige pas qu'il soit sur un chemin (la connexion n'est demandée que pour les portes d'un ascenseur cartographié en surface). Un nœud isolé est donc correct, mais il ne sert pas encore au calcul d'itinéraire piéton. L'appli ne le rattache **pas** au quai : partager un nœud avec le contour du quai déformerait le quai et n'apporterait rien au routage (un quai n'est pas un chemin). Elle le dit à l'utilisateur (« Le point est ajouté seul, sans être relié aux cheminements piétons : on pourra le relier plus tard avec iD ou JOSM ») et le récapitulatif le rappelle. Les ascenseurs déjà reliés à des chemins (cas d'Ambérieu-en-Bugey) se complètent dans l'appli mais **ne s'y suppriment pas** (renvoi vers iD ou JOSM), de même qu'un ascenseur dessiné en surface.

**Niveau.** Placé par rapport à un quai, l'équipement reçoit le `level` du quai s'il existe (prérempli, modifiable). Pour un ascenseur, `level` doit lister **tous** les niveaux desservis : le champ « Niveaux desservis » est prérempli avec le niveau du quai et l'aide invite à ajouter les autres (« -1;0 »). Placé sur la photo aérienne, aucun niveau n'est supposé.

**Doublons.** Avant de créer un équipement, l'appli cherche un objet du même type (nœud, ou centre d'un ascenseur en surface) à moins de 5 m, y compris dans les saisies locales, et propose de le modifier plutôt que d'en créer un autre.

**Suppression** (comme une pancarte, lot 7d) : motif obligatoire — « En double » ou « Mal placé » (permis à distance), « N'existe plus » (sur place seulement) ; seulement un nœud isolé (dans aucun way ni aucune relation), relu sur l'API avant l'envoi (`/node/{id}/ways`, `/node/{id}/relations`) ; s'il a été relié ou modifié entre-temps, la saisie passe « à revoir ».

**Écartés (pas de tag établi, non ajoutés) :**

- **Accueil PMR « Accès Plus » (SNCF)** : la seule trace est `service:SNCF:acces_plus=yes` sur un comptoir `tourism=information`, dans la page [FR:Gares ferroviaires](https://wiki.openstreetmap.org/wiki/FR:Railway_stations) ; aucune page de clé, aucun usage international, valeur propre à un exploitant. Non ajouté ; question posée au forum (`docs/equipements/annonce.md`).
- **Point de rendez-vous** : `amenity=meeting_point` reste une [proposition à l'état de brouillon](https://wiki.openstreetmap.org/wiki/Proposal:Meeting_point) (2015, jamais votée). Non ajouté.
- **Borne d'appel / d'information** (`emergency=phone`, `information=terminal`) : établies, mais hors de la demande ; à étudier dans un lot suivant si Loïc le souhaite.

### 10.3 Escaliers et escaliers mécaniques existants (étape 3)

On **complète** les ways présents dans les données de la gare ; on n'en dessine jamais, on ne les supprime pas et **on ne retourne jamais un way** (les réponses sont relatives à son sens de tracé, montré par une flèche).

| Question (fiche « Escalier »)                                        | Tag écrit                                                                                 | Statut wiki, source                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Dans le sens de la flèche, l'escalier monte-t-il ou descend-il ? » | `incline=up/down` (relatif au sens du way)                                                | de facto, [Tag:highway=steps](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dsteps) : « `incline=up` quand le sens du way monte, `incline=down` sinon »                                                       |
| « Dans quel sens avance-t-il ? » (escalier mécanique, tapis roulant) | `conveying=forward/backward/reversible` (relatif au sens du way)                          | accepté, [DE:Key:conveying](https://wiki.openstreetmap.org/wiki/DE:Key:conveying) (`forward` = sens du way, `yes` = sens inconnu) ; [Tag:highway=steps](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dsteps) |
| « Mains courantes (en suivant la flèche) »                           | `handrail=yes/no` et, si le côté est connu, `handrail:left`/`handrail:right` (`yes`/`no`) | [Tag:highway=steps](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dsteps)                                                                                                                                     |
| « Bandes podotactiles en haut et en bas »                            | `tactile_paving=yes/no`                                                                   | [Key:tactile_paving](https://wiki.openstreetmap.org/Key:tactile_paving) (sur un escalier : `yes` = en haut et en bas)                                                                                            |
| « Nombre de marches » (facultatif)                                   | `step_count=*` (entier, 1 à 500)                                                          | [Tag:highway=steps](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dsteps)                                                                                                                                     |

**Modélisation des escalators.** `highway=steps` + `conveying=*` pour un escalier mécanique ; `highway=footway` + `conveying=*` pour un tapis roulant (DE:Key:conveying, statut « accepté » ; la page [FR:Gares ferroviaires](https://wiki.openstreetmap.org/wiki/FR:Railway_stations) dit aussi « à utiliser systématiquement avec `conveying` »). `conveying=yes` (sens inconnu) déclenche la quête Q11. Un escalier mécanique peut aussi porter `incline` (le wiki le prévoit) : la question est posée s'il manque.

**Écartés :** `tactile_paving=partial` / `incorrect` sur un escalier (bandes en haut seulement / en bas seulement, définis sur la page de la clé mais avec une ambiguïté selon le sens de lecture : non proposés) ; `handrail:center` (non demandé) ; la largeur (`width`), invisible sans mètre.

**Carte.** Trait fin bleu pâle sur liseré ; flèche au milieu du trait quand le sens est connu, pointant **vers le haut** pour un escalier (`incline` converti selon le sens du way) ou dans le **sens de marche** pour un escalier mécanique ou un tapis roulant ; rien si le sens est inconnu ou réversible. La fiche, elle, montre le sens **du way** (schéma, flèche bleue), pour que la question « dans le sens de la flèche » ait un sens univoque.
