# Annonce : équipements utiles aux voyageurs (forum OSM France)

_Brouillon à publier par Loïc dans la catégorie France du forum ([community.openstreetmap.org](https://community.openstreetmap.org/c/communities/fr/)), fil stationcomplete. Court ; les détails sont dans `docs/osm-tags-rapport.md` § 10._

---

**stationcomplete : équipements des quais, ascenseurs, distributeurs de billets et escaliers**

Bonjour à toutes et à tous,

stationcomplete (appli web pour compléter les quais, voies et pancartes d'arrêt des gares) propose désormais de relever, **sur place uniquement**, quelques informations utiles aux voyageurs :

- sur un quai existant : `height` (mètres au-dessus du rail, 0,55 / 0,76 / 0,92 ou autre), `passenger_information_display=yes/no`, `shelter=yes/no`, `tactile_paving=yes/no`, `bench=yes/no`, avec `check_date` ;
- ascenseurs (`highway=elevator` + `level` + `wheelchair`) et distributeurs de billets (`amenity=vending_machine` + `vending=public_transport_tickets`, `operator` facultatif) : ajoutés sur la photo aérienne, ou, à l'intérieur et sous terre, situés par rapport à un quai (l'appli calcule un point dans le contour du quai et propose son `level`). Ce sont des **nœuds isolés**, non reliés aux chemins piétons (le wiki l'accepte ; les relier reste à faire dans iD/JOSM). Un équipement du même type à moins de 5 m est signalé avant d'en créer un autre ; seuls les nœuds isolés se suppriment dans l'appli (motif dans le commentaire) ;
- escaliers existants : `incline=up/down` (relatif au sens du way, montré par une flèche : le way n'est jamais retourné), `handrail` (+ `handrail:left/right`), `tactile_paving`, `step_count` ; escaliers mécaniques et tapis roulants existants : `conveying=forward/backward/reversible`. Aucun escalier n'est dessiné ni supprimé ;

Principes : seulement des tags établis sur le wiki ; « Je ne sais pas » n'écrit rien ; aucun état de panne n'est écrit (OSM ne garde que le durable) ; un quai découpé en parties couvertes reçoit les mêmes valeurs sur chaque partie, sauf `shelter`, écrit sur les parties à l'air libre seulement ; `departures_board` n'est jamais écrit.

Deux questions pour vous :

1. **Hauteur** : le wiki ne documente `height` que sur `railway=platform_edge`. Nous l'écrivons sur le quai (surface), comme c'est déjà l'usage dans beaucoup de gares. Faut-il aussi l'écrire sur les bords de quai reliés ?
2. **Accueil PMR « Accès Plus »** : nous n'avons trouvé que `service:SNCF:acces_plus=yes` (page FR:Gares ferroviaires) et `amenity=meeting_point` (proposition restée à l'état de brouillon). Rien n'est donc proposé dans l'appli. Un balisage fait-il consensus ?

Les changesets portent `#stationcomplete` (OSMCha). Merci pour vos retours !
