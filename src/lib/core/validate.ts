// Contrôles automatiques avant envoi (QA-2, étude docs/qa/etude-qa.md § 2.2). Code pur.
//
// Appliqués à la vue locale (données de la gare + saisies en attente), juste avant l'envoi,
// sur les objets touchés par les saisies à envoyer seulement. Deux niveaux :
// - « error » (bloquant) : la saisie fautive ne part pas ; message clair, lien pour corriger ;
// - « warning » (« à vérifier ») : elle part si l'utilisateur coche « J'ai vérifié »
//   (clés des avertissements gardées dans `Edit.verified`).
//
// Inspiré, sans dépendance, des validateurs d'iD (crossing_ways, close_nodes), de JOSM
// (doublons de nœuds, valeurs de tags) et d'Osmose / OpenRailwayMap (9015 : numéros de voie,
// sens des signaux). Règles propres à l'appli : quai qui croise une voie (iD l'ignore pour les
// surfaces ferroviaires), numéro du quai cohérent avec les voies qu'il longe (quête Q3),
// numéro de voie en double (Q7), équipement en double à moins de 5 m.

import { checkShape, type LonLat } from './draw';
import { applyEdits, editKey, isRemoval, type Edit } from './edits';
import { LocalProjection } from './geo';
import { OsmData, isPlatform, isRail, isUnderground, type BBox, type OsmElement } from './osm';
import { nearbySame, pointKindOf, DUPLICATE_M } from './points';
import { analyzeStation, partKeys } from './quests';
import { levelOk } from './points';
import { isLinked, shapeDiff } from './shape';
import type { CountryCode } from './countries';
import { fmtDecimal, fmtDistance, t as tr } from '../i18n/t.ts';

export type Severity = 'error' | 'warning';

export type RuleId =
	| 'shape'
	| 'trackCrossing'
	| 'duplicateNode'
	| 'signOffTrack'
	| 'signDirection'
	| 'tagValue'
	| 'refWord'
	| 'refFormat'
	| 'trackRefPlace'
	| 'height'
	| 'duplicateTrackRef'
	| 'platformRef'
	| 'duplicateEquipment';

export interface Issue {
	/** Saisie concernée. */
	edit: string;
	rule: RuleId;
	severity: Severity;
	/** Objet concerné (« way/12 », « node/-3 »). */
	target: string;
	/** Clé stable de l'alerte (pour « J'ai vérifié »). */
	key: string;
	message: string;
}

/** Distance sous laquelle deux nœuds d'un même way sont des doublons (5 cm). */
export const DUPLICATE_NODE_M = 0.05;
/** Hauteur plausible d'un quai (m) : au-delà, « à vérifier ». */
export const HEIGHT_PLAUSIBLE = { min: 0.2, max: 1.5 } as const;

const YES_NO = ['yes', 'no'];
/** Valeurs attendues des tags que l'appli écrit (les autres clés ne sont pas contrôlées ici). */
const VALUES: Record<string, string[] | RegExp | ((v: string) => boolean)> = {
	incline: ['up', 'down'],
	conveying: ['forward', 'backward', 'reversible'],
	handrail: YES_NO,
	'handrail:left': YES_NO,
	'handrail:right': YES_NO,
	'handrail:center': YES_NO,
	tactile_paving: YES_NO,
	shelter: YES_NO,
	bench: YES_NO,
	passenger_information_display: YES_NO,
	wheelchair: ['yes', 'no', 'limited'],
	step_count: (v) => /^\d+$/.test(v) && +v >= 1 && +v <= 500,
	level: (v) => levelOk(v),
	check_date: /^\d{4}-\d{2}-\d{2}$/,
	area: ['yes'],
	'railway:signal:direction': ['forward', 'backward'],
	'railway:signal:position': ['left', 'right', 'in_track', 'ground']
};
/** Clés de numéros (valeurs multiples séparées par « ; »). */
const REF_KEYS = ['ref', 'local_ref', 'railway:track_ref'];
/** Mots qui n'ont rien à faire dans un numéro (Osmose 9015009/9015010). */
const REF_WORDS =
	/\b(voies?|quais?|tracks?|platforms?|gleis|bahnsteig|binario|binari|v[ií]as?|and[eé]n)\b/i;

const valueOk = (k: string, v: string) => {
	const rule = VALUES[k];
	if (!rule) return true;
	if (Array.isArray(rule)) return rule.includes(v);
	if (rule instanceof RegExp) return rule.test(v);
	return rule(v);
};

/** Tags écrits par une saisie (valeurs non vides). */
function writtenTags(e: Edit): Record<string, string> {
	const src =
		e.kind === 'tags' || e.kind === 'node' || e.kind === 'way' || e.kind === 'point'
			? e.tags
			: e.kind === 'shape'
				? (e.tags ?? {})
				: {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(src)) if (v !== null && v !== '') out[k] = v;
	return out;
}

/** Objets portant les tags d'une saisie (l'objet, et les autres parties d'un quai). */
function tagTargetsOf(e: Edit): string[] {
	if (e.kind === 'tags') return [e.target, ...(e.parts ?? []).map((p) => p.target)];
	if (isRemoval(e)) return [];
	return [editKey(e)];
}

/**
 * Contrôle les saisies `toSend` sur la vue locale : données de la gare (`elements`) avec
 * toutes les saisies en attente (`all`) appliquées. Renvoie les alertes, saisie par saisie.
 */
export function validateEdits(
	elements: OsmElement[],
	all: Edit[],
	toSend: Edit[],
	bbox: BBox,
	country?: CountryCode
): Issue[] {
	// Même vue que la carte : une forme ou une suppression « à revoir » ne s'applique pas.
	const shown = all.filter((e) => !(e.conflict && (e.kind === 'shape' || isRemoval(e))));
	const after = applyEdits(elements, shown);
	const data = new OsmData(after);
	const analysis = analyzeStation(after, bbox, undefined, country);
	const issues: Issue[] = [];
	const nodeOf = (id: number) => data.nodes.get(id);
	const coordsOf = (wayId: number): LonLat[] => {
		const w = data.ways.get(wayId);
		return w ? data.coords(w) : [];
	};

	/** Analyse de la vue sans une saisie (pour savoir si une alerte vient d'elle). */
	const withoutEdit = (e: Edit) =>
		analyzeStation(
			applyEdits(
				elements,
				shown.filter((x) => x.id !== e.id)
			),
			bbox,
			undefined,
			country
		);

	for (const e of toSend) {
		const push = (rule: RuleId, severity: Severity, target: string, message: string) => {
			const key = `${rule}:${target}`;
			if (!issues.some((i) => i.edit === e.id && i.key === key))
				issues.push({ edit: e.id, rule, severity, target, key, message });
		};

		// ---- Géométrie : contour d'un quai dessiné ou reformé ----
		if (e.kind === 'way' || e.kind === 'shape') {
			const key = editKey(e);
			const wayId = Number(key.split('/')[1]);
			const w = data.ways.get(wayId);
			if (w) {
				const ring = coordsOf(wayId).slice(0, -1);
				for (const msg of checkShape(ring, [], []).errors)
					push('shape', 'error', key, tr('validate.shape', { detail: msg }));
				// Voies au même niveau (une voie en tunnel sous un quai en surface ne le croise pas).
				const under = isUnderground(w.tags);
				const rails = [...data.ways.values()]
					.filter((r) => isRail(r.tags) && isUnderground(r.tags) === under)
					.map((r) => coordsOf(r.id))
					.filter((c) => c.length > 1);
				if (ring.length >= 3 && checkShape(ring, rails, []).errors.includes(tr('draw.check.track')))
					push('trackCrossing', 'error', key, tr('validate.trackCrossing'));
			}
		}

		// ---- Nœuds en double dans un way modifié (au moins un des deux touché par la saisie) ----
		const changedWays: number[] = [];
		const changedNodes = new Set<number>();
		if (e.kind === 'way') {
			changedWays.push(e.tempId);
			e.nodes.forEach((n) => changedNodes.add(n.id));
		} else if (e.kind === 'shape') {
			changedWays.push(Number(e.target.split('/')[1]));
			const before = new Map(e.before.map((n) => [n.id, n]));
			for (const n of e.nodes) {
				const o = before.get(n.id);
				if (!o || o.lon !== n.lon || o.lat !== n.lat) changedNodes.add(n.id);
			}
		} else if (e.kind === 'node') {
			changedWays.push(e.way);
			changedNodes.add(e.tempId);
		}
		for (const wayId of changedWays) {
			const w = data.ways.get(wayId);
			if (!w) continue;
			const ids = [...new Set(w.nodes)];
			for (const a of ids) {
				if (!changedNodes.has(a)) continue;
				const na = nodeOf(a);
				if (!na) continue;
				const proj = new LocalProjection(na.lon, na.lat);
				for (const b of ids) {
					if (b === a) continue;
					const nb = nodeOf(b);
					if (!nb) continue;
					const p = proj.project(nb.lon, nb.lat);
					if (Math.hypot(p.x, p.y) < DUPLICATE_NODE_M)
						push('duplicateNode', 'error', `way/${wayId}`, tr('validate.duplicateNode'));
				}
			}
		}

		// ---- Pancarte d'arrêt : sur une voie, avec un sens ----
		const tags = writtenTags(e);
		const signTouched =
			e.kind === 'node' ||
			(e.kind === 'tags' &&
				e.target.startsWith('node/') &&
				Object.keys(e.tags).some((k) => k.startsWith('railway:signal')));
		if (signTouched) {
			const id =
				e.kind === 'node' ? e.tempId : Number((e as { target: string }).target.split('/')[1]);
			const n = nodeOf(id);
			const target = `node/${id}`;
			const onRail = (data.waysOfNode.get(id) ?? []).some((w) => isRail(data.ways.get(w)?.tags));
			if (!n || !onRail) push('signOffTrack', 'error', target, tr('validate.signOffTrack'));
			const dir = n?.tags?.['railway:signal:direction'];
			if (!dir) push('signDirection', 'error', target, tr('validate.signDirection'));
		}

		// ---- Valeurs des tags écrits par l'appli ----
		const targetsOfTags = tagTargetsOf(e);
		const main = targetsOfTags[0];
		for (const [k, v] of Object.entries(tags)) {
			if (k === 'height') {
				const n = /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
				if (Number.isNaN(n))
					push('tagValue', 'error', main, tr('validate.tagValue', { key: k, value: v }));
				else if (n < HEIGHT_PLAUSIBLE.min || n > HEIGHT_PLAUSIBLE.max)
					push(
						'height',
						'warning',
						main,
						tr('validate.height', {
							value: fmtDecimal(n, 2),
							min: fmtDecimal(HEIGHT_PLAUSIBLE.min),
							max: fmtDecimal(HEIGHT_PLAUSIBLE.max)
						})
					);
			} else if (REF_KEYS.includes(k)) {
				const parts = v.split(';');
				const clean = parts.map((p) => p.trim());
				if (
					clean.some((p) => !p) ||
					parts.some((p, i) => p !== clean[i]) ||
					new Set(clean).size !== clean.length
				)
					push('refFormat', 'error', main, tr('validate.refFormat', { key: k, value: v }));
				else if (REF_WORDS.test(v))
					push('refWord', 'error', main, tr('validate.refWord', { value: v }));
			} else if (!valueOk(k, v))
				push('tagValue', 'error', main, tr('validate.tagValue', { key: k, value: v }));
		}
		if ('railway:track_ref' in tags)
			for (const target of targetsOfTags) {
				const [type, id] = target.split('/');
				const w = type === 'way' ? data.ways.get(Number(id)) : undefined;
				if (!w || !isRail(w.tags))
					push('trackRefPlace', 'error', target, tr('validate.trackRefPlace'));
			}

		// ---- Numéro de voie en double dans la gare (Q7, avertissement) ----
		const trackRef = tags['railway:track_ref'];
		if (trackRef)
			for (const q of analysis.quests)
				if (q.id === 'Q7' && q.details?.motif === 'numéro en double' && q.details.ref === trackRef)
					push(
						'duplicateTrackRef',
						'warning',
						main,
						tr('validate.duplicateTrackRef', { ref: trackRef })
					);

		// ---- Numéro du quai incohérent avec les voies qu'il longe (Q3, avertissement) ----
		const touched = new Set(targetsOfTags);
		if (e.kind === 'shape' || e.kind === 'way') touched.add(editKey(e));
		if ('ref' in tags || trackRef || e.kind === 'shape' || e.kind === 'way')
			for (const q of analysis.quests) {
				if (q.id !== 'Q3' || q.details?.motif === 'parties' || !q.target) continue;
				const p = analysis.platforms.find(
					(x) => x.ref.type === q.target!.type && x.ref.id === q.target!.id
				);
				if (!p) continue;
				const onPlatform = partKeys(p).some((k) => touched.has(k));
				const ownRef = onPlatform && 'ref' in tags;
				const viaTrack =
					(onPlatform && !ownRef) ||
					(!!trackRef && p.tracks.some((tr_) => touched.has(`way/${tr_.way}`)));
				// Numéro du quai écrit par la saisie : toujours à vérifier. Numéro d'une voie, forme du
				// quai : seulement si le quai était cohérent sans cette saisie (une incohérence déjà présente dans OSM
				// n'est pas de son fait ; elle reste une quête Q3).
				const caused =
					ownRef ||
					(viaTrack &&
						!withoutEdit(e).quests.some(
							(b) => b.id === 'Q3' && b.target?.type === p.ref.type && b.target?.id === p.ref.id
						));
				if (caused && isPlatform(p.tags))
					push(
						'platformRef',
						'warning',
						`${p.ref.type}/${p.ref.id}`,
						tr('validate.platformRef', {
							ref: String(q.details?.ref ?? ''),
							tracks: ((q.details?.voies as string[]) ?? []).join(', ')
						})
					);
			}

		// ---- Équipement en double à moins de 5 m (avertissement) ----
		if (e.kind === 'point') {
			const kind = pointKindOf(e.tags);
			if (kind) {
				const near = nearbySame(
					kind,
					[e.lon, e.lat],
					after.filter((x) => !(x.type === 'node' && x.id === e.tempId)),
					DUPLICATE_M
				);
				if (near.length)
					push(
						'duplicateEquipment',
						'warning',
						`node/${e.tempId}`,
						tr('validate.duplicateEquipment', { distance: fmtDistance(near[0].distM) })
					);
			}
		}
	}
	return issues;
}

/** Saisies qui ne partent pas : une erreur, ou un avertissement non vérifié. */
export function heldBack(edits: Edit[], issues: Issue[]): Set<string> {
	const out = new Set<string>();
	for (const e of edits)
		for (const i of issues)
			if (i.edit === e.id && (i.severity === 'error' || !(e.verified ?? []).includes(i.key)))
				out.add(e.id);
	return out;
}

/** Saisies envoyées malgré un avertissement (« J'ai vérifié ») : relecture conseillée. */
export const verifiedWarnings = (edits: Edit[], issues: Issue[]) =>
	edits.filter((e) =>
		issues.some((i) => i.edit === e.id && i.severity === 'warning' && e.verified?.includes(i.key))
	);

/**
 * Demande de relecture cochée d'office (QA-3) : l'envoi contient une suppression, le déplacement
 * d'un point partagé avec d'autres objets, une saisie faite sous déclaration sur l'honneur (mode
 * souterrain), ou un avertissement que l'utilisateur a déclaré vérifié.
 */
export function suggestReview(edits: Edit[], issues: Issue[] = []) {
	return (
		edits.some((e) => {
			if (isRemoval(e) || e.onsite === 'declaration') return true;
			if (e.kind === 'shape') {
				const orig = new Map(e.before.map((n) => [n.id, n]));
				if (shapeDiff(e.before, e.nodes).moved.some((n) => isLinked(orig.get(n.id)!))) return true;
			}
			return false;
		}) || verifiedWarnings(edits, issues).length > 0
	);
}
