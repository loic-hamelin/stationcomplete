# Lot S1 — Ce que Loïc doit vérifier dans son navigateur

_12 novembre 2026. L'API SNCF n'a pas pu être lue depuis l'environnement de développement (proxy : `CONNECT 403`, WebFetch hors liste autorisée). L'intégration suit la documentation publique ; la fixture des tests (`tests/fixtures/sncf-etat-officiel-redige.json`) est **rédigée**, pas réelle. Ces vérifications sont à faire avant la mise en production._

## 1. Le jeu « état » existe et ses noms de champs

Ouvrir dans un navigateur :

<https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/etat-fonctionnement-elevatique-gare/records?limit=2>

- [ ] La réponse est un JSON `{ "total_count": …, "results": [ … ] }`.
- [ ] Noter les **noms exacts** des champs d'un enregistrement. Attendus (supposés) : `id_gare`, `id_equipement`, `nom_de_l_equipement`, `localisation`, `etat_de_fonctionnement…`. La lecture tolère les variantes (« nom… », « localisation… », « etat… », « id_equip… ») ; **seul `id_gare` doit être exact** (constante `SNCF.stationField` de `src/lib/core/officialStatus.ts`).
- [ ] Valeurs de l'état : `OK`, `KO`, `Inconnu` (toute autre valeur s'affiche « Statut inconnu »).
- [ ] Y a-t-il un champ de date de mise à jour par équipement ? (Aujourd'hui l'appli affiche l'heure de **lecture**.)

## 2. Le référentiel « Gares de voyageurs » et le code UIC

<https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/records?where=search(*,%20%228774371%22)&limit=5>

(8774371 = code UIC d'Ambérieu-en-Bugey dans l'index.)

- [ ] L'identifiant du jeu est bien `gares-de-voyageurs` (sinon : constante `SNCF.stationsDataset`). Si l'URL renvoie une erreur 404, chercher le jeu sur <https://ressources.data.sncf.com/explore/> et noter son identifiant.
- [ ] La gare d'Ambérieu est trouvée ; son champ UIC contient bien `8774371` (7 ou 8 chiffres, texte ou liste) ; noter le nom exact du champ `Id_Gare` (attendu `id_gare`).

## 3. Le filtre par gare

Remplacer `XXX` par l'`id_gare` trouvé au point 2 :

<https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/etat-fonctionnement-elevatique-gare/records?where=id_gare%3D%22XXX%22&limit=100>

- [ ] Seuls les équipements de cette gare reviennent ; comparer avec la page officielle (<https://www.garesetconnexions.sncf/fr/gares-services>, chercher la gare, « état des équipements »).
- [ ] Si `id_gare` est numérique et que la requête échoue, le dire : il faudra écrire le filtre sans guillemets.

## 4. CORS (le point bloquant possible)

Sur <https://stationcomplete.org> (ou `npm run preview`), ouvrir la console du navigateur (F12) et coller :

```js
fetch(
	'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/etat-fonctionnement-elevatique-gare/records?limit=1',
	{ credentials: 'omit', referrerPolicy: 'no-referrer' }
).then(async (r) =>
	console.log(r.status, r.headers.get('access-control-allow-origin'), await r.json())
);
```

- [ ] Résultat attendu : `200 *` puis le JSON. Une erreur « CORS » dans la console = l'appli ne pourra pas lire la source directement : couper avec `officialStatusEnabled: false` dans `static/config.json` et me le signaler (variante : demander le CORS à la SNCF).
- [ ] Onglet Réseau : temps de réponse (noter) ; en-têtes de quota éventuels (`X-RateLimit-*`).

## 5. Dans l'appli

1. `npm run build` puis `npx vite preview --port 4174`, ouvrir <http://localhost:4174/gare/?id=w67074448> (Ambérieu) sur le téléphone ou en mode mobile.
2. [ ] La section « Ascenseurs et escaliers mécaniques — état officiel » apparaît sous la liste des tâches, avec les vrais équipements, les mêmes états que la page Gares & Connexions.
3. [ ] Essayer une grande gare (Paris-Nord, Lyon Part-Dieu) et une halte sans ascenseur (rien ne doit s'afficher).
4. [ ] Couper le réseau : la section dit « Hors connexion : état lu le … » (si lue il y a moins de 3 h) ou « indisponible ».

## 6. Conditions particulières d'utilisation SNCF

transport.data.gouv.fr indique « ODbL et Conditions Particulières d'utilisation » ; le groupe SNCF renvoie à des CGU et à une « SNCF Open Data License » (<https://data.sncf.com/pages/cgu/>). **Ces textes n'ont pas pu être lus.**

- [ ] Lire <https://data.sncf.com/pages/cgu/> (ou la page « Informations » du jeu sur ressources.data.sncf.com) et vérifier : forme exacte de l'attribution demandée, obligation d'afficher la date, usage de la marque, limites d'appels, conditions pour les données temps réel. L'appli affiche aujourd'hui « Source : SNCF Gares & Connexions (ODbL) », les libellés tels quels, « Information non contractuelle », sans logo.

## 7. Canaux de signalement affichés (vérifiés le 11/11/2026 sur garesetconnexions.sncf)

- Site des gares : <https://www.garesetconnexions.sncf/fr/gares-services> (recherche de gare). Les pages d'une gare (`/fr/gares-services/<nom>/etat-equipements`) utilisent un nom (`vitry-francois`), **pas** un identifiant : lien direct non construit.
- Formulaire : <https://www.garesetconnexions.sncf/fr/contacts>.
- Assist'enGare : 3212, tous les jours 8 h–20 h ; +33 (0)9 72 72 00 92 depuis l'étranger (<https://www.garesetconnexions.sncf/fr/service-client/service-assistance-gare-PMR/nous-contacter>). C'est un service d'**assistance**, pas de maintenance.
- [ ] Si Gares & Connexions indique un vrai canal de signalement de panne (ou la « Ligne d'Urgence Accessibilité » citée dans sa FAQ, numéro non trouvé), le remplacer dans `countries.ts` (`equipmentStatus.channels`).
