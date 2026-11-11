// Décide si une pull request de Dependabot peut être fusionnée automatiquement.
// Appelé par .github/workflows/dependabot-fusion.yml, APRÈS que le workflow « Déploiement » a réussi
// sur cette pull request (vérifications complètes : types, lint, tests, audit, build, budget, e2e).
//
// Fusion automatique seulement si TOUT est vrai :
//   1. la pull request est ouverte, vers main, ouverte par Dependabot depuis une branche du dépôt,
//      et son dernier commit est bien celui qui vient d'être vérifié ;
//   2. tous ses commits sont de Dependabot et signés par GitHub (personne n'y a ajouté de code) ;
//   3. elle ne touche que package.json et package-lock.json (aucun workflow, aucun code) ;
//   4. chaque dépendance mise à jour est une version mineure ou corrective (jamais une majeure), et :
//      - soit c'est un correctif de sécurité (groupe « securite » de .github/dependabot.yml),
//      - soit c'est un outil de développement direct qui n'est PAS livré aux téléphones (LIVRES).
// Sinon : rien n'est fait, la pull request attend la relecture de Loïc.
//
// Mode d'emploi : docs/securite/robot-dependances.md
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Bibliothèques livrées aux téléphones, et chaîne de construction qui écrit le code livré :
// jamais fusionnées automatiquement hors correctif de sécurité.
// Même liste que le groupe « appli » de .github/dependabot.yml.
export const LIVRES = [
	/^maplibre-gl$/,
	/^idb$/,
	/^osm-auth$/,
	/^svelte$/,
	/^@sveltejs\/kit$/,
	/^@fontsource\//,
	/^vite$/,
	/^@sveltejs\/vite-plugin-svelte$/,
	/^@sveltejs\/adapter-static$/
];
const MINEURES = new Set(['version-update:semver-patch', 'version-update:semver-minor']);
const FICHIERS_PERMIS = new Set(['package.json', 'package-lock.json']);
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** « ^8.3.0 » → [8, 3, 0] ; null si la plage n'est pas une simple version. */
function version(plage) {
	const m = String(plage).match(/^[\^~=v]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
	return m ? m.slice(1).map((x) => Number(x ?? 0)) : null;
}

/** Changement incompatible au sens semver (0.x : la mineure compte comme majeure). */
function estMajeure(avant, apres) {
	const a = version(avant);
	const b = version(apres);
	if (!a || !b) return true;
	return a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1]);
}

/**
 * Compare package.json avant et après, indépendamment de ce que dit le message de commit.
 * Renvoie la liste des dépendances modifiées, ou une raison de refus.
 */
export function comparerPackageJson(avant, apres) {
	const modifiees = [];
	for (const section of SECTIONS) {
		const a = avant[section] ?? {};
		const b = apres[section] ?? {};
		for (const nom of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (a[nom] === b[nom]) continue;
			if (!(nom in a) || !(nom in b)) return { refus: `${nom} ajouté ou retiré dans ${section}` };
			if (estMajeure(a[nom], b[nom])) return { refus: `${nom} : ${a[nom]} → ${b[nom]} (majeure)` };
			modifiees.push({ nom, section });
		}
	}
	for (const cle of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
		if (SECTIONS.includes(cle)) continue;
		if (JSON.stringify(avant[cle]) !== JSON.stringify(apres[cle])) {
			return { refus: `champ « ${cle} » de package.json modifié` };
		}
	}
	return { modifiees };
}

/** Lit le bloc de métadonnées que Dependabot écrit dans chaque message de commit. */
export function lireMetadonnees(message) {
	// On prend le DERNIER bloc : les notes de version recopiées plus haut dans le message viennent
	// de l'auteur du paquet et pourraient imiter ce bloc.
	const debut = message.lastIndexOf('\n---\nupdated-dependencies:');
	if (debut < 0) return null;
	const reste = message.slice(debut + 5);
	const fin = reste.search(/^\.{3}$/m);
	if (fin < 0) return null;
	const bloc = reste.slice(0, fin);
	const valeur = (texte, cle) =>
		texte
			.match(new RegExp(`^\\s*-?\\s*${cle}:\\s*(.+)$`, 'm'))?.[1]
			.trim()
			.replace(/^['"]|['"]$/g, '');
	const dependances = bloc
		.split(/^\s*-\s+(?=dependency-name:)/m)
		.slice(1)
		.map((t) => ({
			nom: valeur(t, 'dependency-name'),
			type: valeur(t, 'dependency-type'),
			miseAJour: valeur(t, 'update-type'),
			groupe: valeur(t, 'dependency-group')
		}));
	const groupe = bloc.match(/dependency-group:\s*(\S+)/)?.[1]?.replace(/^['"]|['"]$/g, '');
	return { dependances, groupe };
}

/** Règle de décision, sans appel réseau (testable). Renvoie { fusion, raison }. */
export function decider({ message, branche, fichiers, pkgAvant, pkgApres }) {
	const delim = branche[10];
	const ecosysteme = branche.split(delim)[1];
	if (ecosysteme !== 'npm_and_yarn') {
		return { fusion: false, raison: `écosystème « ${ecosysteme} » : relecture manuelle` };
	}
	const autres = fichiers.filter((f) => !FICHIERS_PERMIS.has(f));
	if (autres.length > 0) {
		return { fusion: false, raison: `fichiers inattendus modifiés : ${autres.join(', ')}` };
	}
	const meta = lireMetadonnees(message);
	if (!meta || meta.dependances.length === 0) {
		return { fusion: false, raison: 'métadonnées Dependabot introuvables dans le commit' };
	}
	for (const d of meta.dependances) {
		const groupe = d.groupe ?? meta.groupe;
		if (!d.nom || !MINEURES.has(d.miseAJour)) {
			return {
				fusion: false,
				raison: `${d.nom} : mise à jour « ${d.miseAJour ?? 'inconnue'} » (majeure ou inconnue)`
			};
		}
		if (groupe === 'securite') continue;
		if (d.type !== 'direct:development') {
			return {
				fusion: false,
				raison: `${d.nom} : dépendance « ${d.type} » (pas un outil de développement)`
			};
		}
		if (LIVRES.some((r) => r.test(d.nom))) {
			return { fusion: false, raison: `${d.nom} : livré aux téléphones ou chaîne de construction` };
		}
	}
	// Contre-vérification sur le contenu réel de package.json (le message pourrait mentir).
	const comparaison = comparerPackageJson(pkgAvant, pkgApres);
	if (comparaison.refus) return { fusion: false, raison: comparaison.refus };
	const securite = meta.dependances.every((d) => (d.groupe ?? meta.groupe) === 'securite');
	for (const { nom, section } of comparaison.modifiees) {
		if (!meta.dependances.some((d) => d.nom === nom)) {
			return { fusion: false, raison: `${nom} modifié sans être annoncé par Dependabot` };
		}
		if (securite) continue;
		if (section !== 'devDependencies' || LIVRES.some((r) => r.test(nom))) {
			return {
				fusion: false,
				raison: `${nom} (${section}) : livré aux téléphones ou chaîne de construction`
			};
		}
	}
	const noms = meta.dependances.map((d) => d.nom).join(', ');
	return {
		fusion: true,
		raison: `${securite ? 'correctif de sécurité non majeur' : 'outils de développement, version mineure ou corrective'} : ${noms}`
	};
}

const gh = (...args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }));

function principal() {
	const { REPO, SHA, BRANCHE } = process.env;
	let pr = process.env.PR;
	if (!pr) pr = gh(`repos/${REPO}/commits/${SHA}/pulls`).find((p) => p.state === 'open')?.number;

	const sortie = (fusion, raison) => {
		console.log(
			`Pull request #${pr ?? '?'} : ${fusion ? 'fusion automatique' : 'relecture manuelle'} (${raison})`
		);
		if (process.env.GITHUB_OUTPUT) {
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				`fusion=${fusion ? 'oui' : 'non'}\npr=${pr ?? ''}\n`
			);
		}
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(
				process.env.GITHUB_STEP_SUMMARY,
				`### Dependabot #${pr ?? '?'}\n\n**${fusion ? 'Fusion automatique' : 'Relecture manuelle'}** : ${raison}\n`
			);
		}
	};

	if (!pr) return sortie(false, 'pull request introuvable');
	const p = gh(`repos/${REPO}/pulls/${pr}`);
	if (p.state !== 'open') return sortie(false, 'pull request fermée');
	if (p.user?.login !== 'dependabot[bot]') return sortie(false, `ouverte par ${p.user?.login}`);
	if (p.base?.ref !== 'main') return sortie(false, `vise ${p.base?.ref}`);
	if (p.head?.repo?.full_name !== REPO || p.head?.ref !== BRANCHE)
		return sortie(false, 'branche inattendue');
	if (p.head?.sha !== SHA)
		return sortie(false, 'nouveau commit depuis la vérification : on attendra la suivante');

	const commits = gh(`repos/${REPO}/pulls/${pr}/commits?per_page=100`);
	const etranger = commits.find(
		(c) => c.author?.login !== 'dependabot[bot]' || !c.commit?.verification?.verified
	);
	if (etranger) return sortie(false, `commit ${etranger.sha.slice(0, 7)} non signé par Dependabot`);

	const fichiers = gh(`repos/${REPO}/pulls/${pr}/files?per_page=100`).map((f) => f.filename);
	const contenu = (ref) =>
		JSON.parse(
			Buffer.from(gh(`repos/${REPO}/contents/package.json?ref=${ref}`).content, 'base64').toString(
				'utf8'
			)
		);
	const { fusion, raison } = decider({
		message: commits.at(-1).commit.message,
		branche: BRANCHE,
		fichiers,
		pkgAvant: contenu(p.base.sha),
		pkgApres: contenu(SHA)
	});
	sortie(fusion, raison);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
