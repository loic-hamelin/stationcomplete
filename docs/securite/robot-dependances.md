# Robot de sécurité des dépendances : mode d'emploi

_Mis en place le 11 novembre 2026. Fichiers : `.github/dependabot.yml`, `.github/workflows/` (`deploy.yml`, `dependabot-fusion.yml`, `codeql.yml`, `stations.yml`), `.github/scripts/`, `.github/SECURITY.md`._

stationcomplete s'appuie sur 24 bibliothèques directes (3 livrées comme telles, 21 outils de développement), soit environ 240 paquets en comptant leurs propres dépendances. Quand une faille (CVE) est publiée dans l'une d'elles, il faut la corriger vite. Il faut aussi éviter l'inverse : installer une version piégée publiée par un pirate. Ce dispositif fait l'essentiel tout seul et ne demande à Loïc que les décisions qui comptent.

## 1. Ce qui est en place

| Pièce                                                               | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dependabot** (`.github/dependabot.yml`)                           | Robot de GitHub. Chaque mardi à 6 h, il propose des pull requests (PR) de mise à jour pour npm et pour les actions GitHub. Il propose les correctifs de sécurité dès qu'une faille est connue, sans attendre le mardi.                                                                                                                                                                                                              |
| **Délai de stabilité** (`cooldown`)                                 | Une nouvelle version n'est proposée que **7 jours** après sa publication (**14 jours** pour une version majeure). La plupart des paquets piégés sont repérés et retirés de npm en quelques heures ou quelques jours. Ce délai ne s'applique pas aux correctifs de sécurité.                                                                                                                                                         |
| **Vérifications des PR** (`deploy.yml`, job « Vérifications »)      | Chaque PR passe exactement les mêmes vérifications qu'un envoi sur `main` (types, mise en forme, lint, tests unitaires, audit, build, budget de poids, tests de bout en bout), **sans rien publier**. Seul un envoi sur `main` (ou un lancement manuel sur `main`) publie le site.                                                                                                                                                  |
| **Audit des dépendances** (`.github/scripts/audit-dependances.mjs`) | À chaque vérification. **Bloquant** si une faille élevée ou critique touche du code **livré aux téléphones** : les `dependencies` (maplibre-gl, idb, osm-auth et ce qu'elles tirent), plus svelte, @sveltejs/kit et la police @fontsource. **Informatif** pour les outils de développement (vite, eslint…), qui ne quittent jamais l'ordinateur ou la CI : tableau dans le résumé de l'exécution.                                   |
| **Fusion automatique** (`dependabot-fusion.yml`)                    | Quand les vérifications d'une PR de Dependabot réussissent, un second workflow décide (règle au § 3) s'il peut la fusionner seul, puis relance la publication.                                                                                                                                                                                                                                                                      |
| **CodeQL** (`codeql.yml`)                                           | Analyse de sécurité du code de l'appli (JavaScript/TypeScript) et des workflows eux-mêmes, à chaque envoi, à chaque PR et chaque mercredi. Les résultats arrivent dans **Security → Code scanning**. CodeQL ne bloque pas la publication.                                                                                                                                                                                           |
| **Durcissement des workflows**                                      | Aucun droit par défaut (`permissions: {}`) : chaque job demande seulement ce qu'il lui faut. Actions figées par **empreinte de commit** (SHA, avec la version en commentaire, que Dependabot met à jour). `persist-credentials: false` partout sauf dans le job qui pousse l'index des gares. `npm ci --ignore-scripts` : aucun script d'installation de paquet ne s'exécute dans la CI (seul `fsevents`, propre à macOS, en a un). |
| **Signalement des failles** (`.github/SECURITY.md`)                 | Explique comment signaler une faille en privé : formulaire « Report a vulnerability » de GitHub, ou contact@stationcomplete.org.                                                                                                                                                                                                                                                                                                    |

### Les familles de PR

| PR de Dependabot                                | Contenu                                                                                                                                                                                                                    | Qui fusionne                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| « …the **securite** group… »                    | Correctifs de sécurité (toutes bibliothèques)                                                                                                                                                                              | **Robot**, si aucune version majeure et CI verte |
| « …the **outils-dev** group… » ou un outil seul | Versions mineures et correctives des autres outils de développement (eslint, prettier, typescript, vitest, playwright…)                                                                                                    | **Robot**, si CI verte                           |
| « …the **appli** group… »                       | Versions mineures et correctives de maplibre-gl, idb, osm-auth, svelte, @sveltejs/kit, @fontsource, et de la chaîne de construction qui écrit le code livré (vite, @sveltejs/vite-plugin-svelte, @sveltejs/adapter-static) | **Loïc**                                         |
| Une bibliothèque de x.… à y.… (majeure)         | Changement de version majeure (changements incompatibles possibles), une PR par bibliothèque                                                                                                                               | **Loïc**                                         |
| « …the **actions** group… », « Actions: … »     | Actions GitHub des workflows                                                                                                                                                                                               | **Loïc**                                         |

Au plus 5 PR npm et 3 PR d'actions ouvertes en même temps (hors correctifs de sécurité). Les types de Node (`@types/node`) ne passent jamais en majeure : ils suivent Node 22.

## 2. Ce que fait le robot chaque semaine

1. **Mardi vers 6 h** : Dependabot regarde les nouvelles versions publiées depuis au moins 7 jours (14 pour une majeure) et ouvre les PR des familles ci-dessus.
2. **Quelques minutes après** : chaque PR lance « Déploiement » (job « Vérifications », environ 10 minutes) et « CodeQL ».
3. **Si les vérifications réussissent** et que la PR est dans une famille « Robot » : elle est fusionnée (en un seul commit, « squash ») et la publication du site est relancée. Elle repasse donc encore toutes les vérifications sur `main` avant d'être publiée.
4. **Sinon**, la PR reste ouverte. C'est le signal qu'elle attend Loïc.
5. Après chaque fusion, Dependabot met à jour (« rebase ») les autres PR si besoin ; elles repassent les vérifications.
6. **Mercredi** : CodeQL refait une analyse complète avec ses règles les plus récentes.
7. **N'importe quel jour** : une faille publiée déclenche une alerte (Security → Dependabot) et, si un correctif existe, une PR « securite ».

## 3. La règle de fusion automatique, en détail

Le workflow `dependabot-fusion.yml` démarre quand « Déploiement » se termine. Il ne fait quelque chose que si **tout** est vrai :

1. l'exécution vérifiait une **PR ouverte par Dependabot**, depuis une branche `dependabot/…` du dépôt (jamais une copie extérieure), et elle a **réussi** (toutes les étapes) ;
2. la PR n'a pas changé depuis cette vérification (même dernier commit) ;
3. tous ses commits sont de Dependabot et **signés par GitHub** : si quelqu'un, même Loïc, y ajoute un commit, la fusion redevient manuelle ;
4. elle ne modifie **que** `package.json` et `package-lock.json` ;
5. pour chaque bibliothèque mise à jour : version **mineure ou corrective** seulement, et :
   - soit c'est un **correctif de sécurité** (groupe « securite ») ;
   - soit c'est un **outil de développement** qui n'est ni livré aux téléphones, ni dans la chaîne de construction (vite et les plugins SvelteKit restent en relecture : ils écrivent eux-mêmes le code livré) ;
6. contre-vérification indépendante : le robot compare lui-même `package.json` avant et après. Aucune dépendance ajoutée ou retirée, aucun autre champ modifié (ex. `scripts`), aucune majeure, et rien d'autre que ce que Dependabot annonce.

Le code de la PR n'est **jamais exécuté** par ce workflow : il lit seulement son propre script sur `main` et interroge l'API de GitHub. Le résumé de chaque exécution (onglet Actions → « Dependabot : fusion automatique ») indique la décision et sa raison.

**Pourquoi pas l'« auto-merge » intégré à GitHub ?** Il demande une règle de protection de `main` exigeant les vérifications. Une telle règle bloquerait les envois directs sur `main` (la façon de travailler actuelle) et le robot « Index des gares », qui pousse l'index chaque lundi. De plus, une fusion déclenchée par le jeton des workflows ne lance pas la publication. La solution retenue fusionne seulement après la réussite des vérifications, et relance la publication elle-même.

**Risques acceptés.** (a) Une mise à jour mineure d'un outil de développement peut, rarement, casser quelque chose que les tests ne voient pas. Le code livré ne bouge pas, et `git revert` suffit à revenir en arrière. (b) Un outil de développement compromis (eslint, prettier, vitest…) s'exécuterait dans la CI, dans le même job que la construction du site : il pourrait en théorie modifier le code avant sa publication. Ce job n'a ni droit d'écriture ni secret, mais le site publié pourrait être piégé. Parades : le délai de 7 jours (les versions piégées de 2025, comme `chalk`/`debug` ou `nx`, ont été retirées en quelques heures), `--ignore-scripts` (bloque le vecteur le plus courant, le script d'installation), la CSP stricte (un script injecté ne peut parler qu'à OSM et à l'IGN) et la relecture manuelle de la chaîne de construction. Le risque est réduit, pas nul. (c) Un correctif de sécurité mineur d'une bibliothèque livrée part en production sans relecture humaine. Il a passé tous les tests, y compris les parcours de bout en bout ; c'est le compromis choisi pour corriger vite.

## 4. Quand une PR arrive : ce que fait Loïc

GitHub envoie un courriel pour chaque PR. Règle simple : **une PR de Dependabot encore ouverte une heure après son arrivée attend une décision.**

1. Ouvrir la PR, onglet **Checks** (ou le bas de la page) :
   - **tout est vert** : lire le titre et la description (Dependabot y recopie les notes de version et, pour une majeure, les changements incompatibles) ;
   - **une vérification est rouge** : cliquer sur « Details » pour voir l'étape en échec, puis passer à l'étape 3.
2. Vert, famille « appli » ou « actions » : une PR n'est jamais publiée, il n'y a donc pas de site de test. Les tests de bout en bout ont déjà parcouru l'appli. Pour maplibre-gl et svelte, mieux vaut regarder soi-même : lancer `npm run dev` sur la branche de la PR (ou demander à Claude de le faire) et vérifier la carte. Si tout va bien : **Squash and merge**. La publication part toute seule.
3. Rouge, ou majeure qui demande d'adapter le code : écrire `@dependabot` suivi d'une commande en commentaire de la PR, ou demander à Claude d'adapter le code sur la branche :
   - `@dependabot rebase` : refaire la PR à partir du `main` actuel ;
   - `@dependabot recreate` : la refaire entièrement ;
   - `@dependabot ignore this major version` (ou `minor version`, ou `dependency`) : ne plus proposer cette version ;
   - fermer la PR sans fusionner : Dependabot ne la reproposera pas avant la version suivante.
4. Une PR fusionnée par le robot qui pose un problème : sur la PR, bouton **Revert** (crée une PR d'annulation), la fusionner, puis `@dependabot ignore this minor version` sur la PR d'origine.

## 5. En cas d'alerte critique

Une alerte arrive par courriel (« Dependabot alert ») et dans **Security → Dependabot**.

1. **Lire l'alerte** : quelle bibliothèque, quelle gravité, et surtout si elle est **livrée** (dans `dependencies`, ou svelte, @sveltejs/kit, @fontsource) ou seulement un outil de développement. Pour un outil de développement, le risque concerne l'ordinateur et la CI, pas les utilisateurs.
2. **Un correctif existe** : Dependabot ouvre une PR « securite » en quelques minutes. Si elle est fusionnée automatiquement, c'est fini (vérifier que la publication est verte dans Actions). Sinon (majeure), la relire en priorité (§ 4).
3. **Pas encore de correctif**, et la faille est livrée et exploitable dans stationcomplete (par exemple une injection de code dans un traitement de données venues d'OSM) :
   - couper les envois vers OSM avec l'arrêt d'urgence (`docs/lot6/arret-urgence.md`) si la faille peut conduire à des modifications malveillantes ;
   - demander à Claude un contournement (version précédente, désactivation de la fonction touchée) ;
   - si la faille n'est pas exploitable dans stationcomplete : Security → l'alerte → **Dismiss alert** → « Vulnerable code is not actually used », avec une phrase d'explication.
4. **Une publication est bloquée par l'audit** (étape « Audit des dépendances » en rouge) : le site en ligne reste la version précédente, rien n'est cassé. Le résumé de l'exécution liste le paquet et la faille ; suivre les étapes 2 et 3.
5. **Quelqu'un signale une faille** (formulaire privé ou courriel) : répondre sous 7 jours, corriger, puis publier un avis (Security → Advisories) en citant la personne si elle le souhaite.

## 6. Désactiver ou mettre en pause

| Pour arrêter…                       | Faire                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| la fusion automatique seule         | Onglet **Actions** → « Dependabot : fusion automatique » → bouton **⋯** → **Disable workflow**. Les PR restent proposées, Loïc les fusionne à la main. |
| les PR de mise à jour hebdomadaires | Dans `.github/dependabot.yml`, mettre `open-pull-requests-limit: 0` sur l'écosystème voulu. Les correctifs de sécurité continuent.                     |
| les correctifs de sécurité          | Settings → Advanced Security → **Dependabot security updates** → Disable (déconseillé).                                                                |
| CodeQL                              | Actions → « CodeQL » → **⋯** → **Disable workflow**.                                                                                                   |
| l'audit bloquant (urgence)          | Commenter l'étape « Audit des dépendances » dans `deploy.yml` le temps de corriger, puis la remettre.                                                  |

## 7. Ce qui a été comparé (11 novembre 2026)

**OSRD** (`OpenRailAssociation/osrd`, `osrd-ui`) utilise **Dependabot** seul, sans Renovate : un bloc par écosystème (cargo, npm, uv, gradle, docker, github-actions), des mises à jour hebdomadaires ou quotidiennes, un délai de stabilité de 5 jours, des groupes par famille de bibliothèques plus un groupe « patch », des labels par domaine et des préfixes de commit. Côté workflows : droits définis par job, `persist-credentials: false` partout, file de fusion (`merge_group`), et **zizmor** (analyse de sécurité des workflows) en CI. Ses actions sont figées par version (`@v7.0.1`), pas par SHA. OSRD n'a ni CodeQL, ni OSV-Scanner, ni fusion automatique dans ses workflows : une équipe relit chaque PR. Son `SECURITY.md` renvoie vers le signalement privé de GitHub.

**Dependabot plutôt que Renovate** : Dependabot est intégré à GitHub (rien à installer, aucune application tierce avec des droits d'écriture), relié directement aux alertes de sécurité, et utilisé par OSRD. Il offre maintenant ce qui manquait (groupes, délai de stabilité, mise à jour des SHA d'actions). Renovate a une fusion automatique intégrée plus fine, mais demande d'installer l'application Mend et apprendre sa configuration. C'est trop pour un mainteneur seul.

**Non retenus, pour ne pas surcharger** : OpenSSF Scorecard (note de bonnes pratiques ; utile pour un badge, mais une partie des critères suppose une équipe de relecteurs) ; step-security/harden-runner (surveillance réseau des jobs : action tierce présente dans chaque job, intérêt réel surtout avec leur service en ligne) ; OSV-Scanner (même base de failles que `npm audit` et Dependabot) ; zizmor en CI (CodeQL analyse déjà les workflows ; zizmor a servi à vérifier ces fichiers, 0 problème). À reconsidérer si le projet accueille d'autres mainteneurs.

## 8. Vérifier que tout marche (après l'activation des réglages)

1. **Insights → Dependency graph → Dependabot** : les deux lignes (npm `/` et github-actions `/`) affichent « Last checked … » sans erreur. Le lien **Check for updates** force une vérification immédiate.
2. **Actions** : « Déploiement », « CodeQL » et « Index des gares » sont verts sur `main`.
3. **Security → Code scanning** : les analyses « javascript-typescript » et « actions » apparaissent après le premier envoi.
4. À la première PR fusionnée par le robot : Actions → « Dependabot : fusion automatique » → le résumé dit « Fusion automatique : … », puis une exécution « Déploiement » démarre sur `main`.
