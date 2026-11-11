// Audit des dépendances npm pour la CI (workflow « Déploiement », job « Vérifications »).
//
// Bloquant (code de sortie 1) : une faille de gravité élevée (high) ou critique (critical) dans ce
// qui est LIVRÉ aux téléphones :
//   - les dépendances d'exécution (`dependencies` de package.json et tout ce qu'elles tirent) ;
//   - les paquets de développement dont le code finit malgré tout dans le site : svelte,
//     @sveltejs/kit et les polices @fontsource/* (voir LIVRES_EN_DEV ci-dessous).
// Informatif (tableau dans le résumé du job, sans bloquer) : tout le reste (outils de
// développement : vite, eslint, prettier, playwright…), qui ne quitte jamais l'ordinateur ou la CI.
//
// Si le registre npm ne répond pas, l'audit est signalé comme non fait, sans bloquer la publication :
// Dependabot surveille de toute façon le dépôt en continu.
//
// Lancement local : node .github/scripts/audit-dependances.mjs
// Documentation : docs/securite/robot-dependances.md
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const LIVRES_EN_DEV = [/^svelte$/, /^@sveltejs\/kit$/, /^@fontsource\//];
const GRAVES = new Set(['high', 'critical']);
const RANG = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function audit(args) {
	let sortie;
	try {
		sortie = execFileSync('npm', ['audit', '--json', ...args], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		});
	} catch (e) {
		// npm audit sort en erreur dès qu'il trouve une faille : on lit quand même le JSON.
		sortie = e.stdout ?? '';
	}
	try {
		const rapport = JSON.parse(sortie);
		if (rapport.error) return { erreur: rapport.error.summary ?? JSON.stringify(rapport.error) };
		return { failles: rapport.vulnerabilities ?? {} };
	} catch {
		return { erreur: 'réponse illisible de npm audit' };
	}
}

const resume = (texte) => {
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + '\n');
};

const livre = audit(['--omit=dev']);
const tout = audit([]);

if (livre.erreur || tout.erreur) {
	const msg = `Audit des dépendances non fait : ${livre.erreur ?? tout.erreur}`;
	console.log(`::warning title=Audit npm::${msg}`);
	resume(`### Audit des dépendances\n\n⚠️ ${msg}`);
	process.exit(0);
}

const lignes = Object.values(tout.failles)
	.map((f) => {
		const estLivre = f.name in livre.failles || LIVRES_EN_DEV.some((r) => r.test(f.name));
		const avis = f.via
			.filter((v) => typeof v === 'object')
			.map((v) => `[${v.title}](${v.url})`)
			.join(' ; ');
		const via = f.via.filter((v) => typeof v === 'string').join(', ');
		return { ...f, estLivre, bloquant: estLivre && GRAVES.has(f.severity), avis, viaTexte: via };
	})
	.sort((a, b) => b.bloquant - a.bloquant || RANG[b.severity] - RANG[a.severity]);

const bloquants = lignes.filter((l) => l.bloquant);

let md = '### Audit des dépendances\n\n';
if (lignes.length === 0) {
	md += 'Aucune faille connue.\n';
} else {
	md += `${lignes.length} paquet(s) concerné(s), dont **${bloquants.length} bloquant(s)** `;
	md += '(gravité élevée ou critique dans le code livré).\n\n';
	md += '| Paquet | Gravité | Livré | Bloquant | Faille ou chaîne | Correctif |\n';
	md += '| --- | --- | --- | --- | --- | --- |\n';
	for (const l of lignes) {
		const correctif =
			l.fixAvailable === true
				? 'oui'
				: l.fixAvailable
					? `${l.fixAvailable.name}@${l.fixAvailable.version}${l.fixAvailable.isSemVerMajor ? ' (majeure)' : ''}`
					: 'non';
		md += `| ${l.name} | ${l.severity} | ${l.estLivre ? 'oui' : 'non'} | ${l.bloquant ? '**oui**' : 'non'} | ${l.avis || 'via ' + l.viaTexte} | ${correctif} |\n`;
	}
}
resume(md);

// Annotations visibles sur la page de l'exécution : seulement les failles élevées ou critiques.
for (const l of lignes.filter((l) => GRAVES.has(l.severity))) {
	const niveau = l.bloquant ? 'error' : 'warning';
	console.log(
		`::${niveau} title=Audit npm::${l.name} (${l.severity}${l.estLivre ? ', livré' : ''})`
	);
}

if (bloquants.length > 0) {
	console.log(
		`\n${bloquants.length} faille(s) élevée(s) ou critique(s) dans le code livré : publication bloquée.` +
			'\nVoir docs/securite/robot-dependances.md (« Alerte critique »).'
	);
	process.exit(1);
}
console.log(`Audit : ${lignes.length} paquet(s) signalé(s), aucun bloquant.`);
