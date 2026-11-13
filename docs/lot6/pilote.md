# Pilote stationcomplete : protocole

**But :** vérifier en conditions réelles que l'appli produit des données justes, avant l'ouverture à tous.
**Durée :** 2 semaines au moins.
**Participants :** 3 à 5 testeurs, dans 3 gares au moins, plus un relecteur (cartographe ferroviaire expérimenté).

## Critères de réussite (plan du lot 6)

1. Les premiers changesets réels sont relus par le relecteur, sans objection.
2. Deux semaines sans bug critique (bug critique = donnée fausse envoyée, doublon, perte de saisie, envoi impossible).
3. L'arrêt d'urgence a été testé : coupure, puis réactivation (voir `arret-urgence.md`).

## Avant de commencer (Loïc)

- [ ] Application OAuth de production déclarée, Client ID intégré à l'appli.
- [ ] Page wiki publiée (User:LoicHam/Stationcomplete ; à renommer en FR:Stationcomplete quand le compte wiki sera confirmé).
- [ ] Annonce publiée sur le forum OSM France.
- [ ] Message envoyé aux administrateurs de l'API (`courriel-osmf-operations.md`).
- [ ] Pseudos OSM des testeurs ajoutés dans `pilotUsers` (`static/config.json`).
- [ ] Choisir 3 gares variées : une halte simple (2 quais), une gare moyenne avec des voies numérotées, une gare où des pancartes d'arrêt manquent.
- [ ] Désigner le relecteur.

## Message à envoyer aux testeurs

> Bonjour,
>
> Merci d'avoir accepté de tester stationcomplete, une appli qui aide à compléter les quais, les voies et les pancartes d'arrêt des gares dans OpenStreetMap.
>
> 1. Il vous faut un compte OpenStreetMap (gratuit, https://www.openstreetmap.org/user/new). Envoyez-moi votre pseudo pour que j'ouvre l'envoi sur votre compte.
> 2. Sur votre téléphone, ouvrez https://stationcomplete.org, puis « Ajouter à l'écran d'accueil ».
> 3. Vérifiez dans **Réglages** que le serveur est bien « OpenStreetMap » (et non le serveur de test).
> 4. En gare, **restez toujours derrière la ligne de sécurité** et ne descendez jamais sur les voies.
> 5. Complétez ce que vous voyez, relisez dans « Mes contributions », puis envoyez.
> 6. Après chaque gare, répondez aux questions ci-dessous (par courriel à contact@stationcomplete.org).
>
> Vos modifications sont publiques et seront relues. Au moindre doute sur une donnée, ne l'envoyez pas.
>
> Merci !

## Questions après chaque gare (testeurs)

1. Gare, date, téléphone et navigateur utilisés.
2. Combien de saisies envoyées ? Lien du changeset (affiché après l'envoi).
3. Une saisie vous a-t-elle paru impossible ou ambiguë (quai, voie, pancarte) ? Laquelle ?
4. Un message d'erreur, une perte de saisie, un écran bloqué ? Que faisiez-vous ?
5. Combien de temps passé en gare ? Batterie consommée (approximativement) ?
6. Qu'est-ce qui vous a le plus gêné ? Qu'est-ce qui vous a plu ?

## Relecture des changesets (relecteur)

Pour chaque changeset #stationcomplete du pilote :

- [ ] Les numéros de quais (`ref`, `local_ref`) correspondent à la réalité (photo, connaissance de la gare, horaires affichés).
- [ ] Les numéros de voies (`railway:track_ref`) sont posés sur les bonnes voies.
- [ ] Les pancartes sont sur la bonne voie, du bon côté (`railway:signal:position`) et dans le bon sens (`railway:signal:direction`), à environ 1 m près.
- [ ] Les quais dessinés ne touchent pas les voies et ont une forme correcte (le validateur de JOSM ne signale rien).
- [ ] Formes modifiées : les objets qui partagent un point déplacé (gare, toit, bord de quai…) restent cohérents.
- [ ] Suppressions (quai, pancarte, équipement isolé) : le motif du commentaire est plausible, rien d'autre n'a disparu.
- [ ] Aucune modification hors des clés listées sur la page wiki.

**Priorité : les demandes de relecture.** Dans OSMCha (connecté avec un compte OSM), filtre sauvegardé : _Editor_ (`created_by`) contient `stationcomplete`, _Show flagged_ = yes, _Reason for flagging_ = **Review requested** (`review_requested=yes`), suivi par RSS. L'appli coche d'office cette demande pour une suppression, un point partagé déplacé, une saisie en gare souterraine faite sur déclaration sur l'honneur, ou un avertissement des contrôles avant envoi que le testeur a déclaré vérifié ; le testeur peut aussi la cocher lui-même. Relire ces changesets en premier, sous 2 jours ouvrés.

Notez chaque problème : changeset, objet, ce qui est faux.

## Suivi (Loïc)

| Gare | Testeur | Date | Changeset | Relu ? | Problèmes |
| ---- | ------- | ---- | --------- | ------ | --------- |
|      |         |      |           |        |           |

Relevez aussi, pour la réponse aux administrateurs de l'API : le nombre de gares ouvertes par jour pendant le pilote (une ouverture = un appel `map` au plus par jour et par téléphone).

## Fin du pilote

- Les 3 critères sont remplis → mettre `"pilotUsers": null`, donner les volumes mesurés aux administrateurs de l'API (réponse sur le même fil), et répondre sur le fil du forum pour annoncer l'ouverture.
- Sinon : corriger, puis prolonger le pilote.
