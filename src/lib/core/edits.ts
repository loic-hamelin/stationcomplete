// Modifications saisies dans l'appli, gardées sur le téléphone jusqu'à leur envoi (lot 3).
// Code pur : application des modifications aux données OSM et contrôles de saisie.
// (Tags des pancartes d'arrêt : schéma du pays, dans stopsigns/.)

import type { CountryCode } from './countries';
import { LocalProjection, projectOnSegment, type Pt } from './geo';
import type { OsmElement, OsmNode, OsmWay, Tags } from './osm';
import { t as tr, tk } from '../i18n/t.ts';

export type ElementKey = `${'node' | 'way' | 'relation'}/${number}`;

interface EditBase {
	/** Identifiant local unique (horodatage + hasard). */
	id: string;
	station: string;
	createdAt: number;
	/** Serveur OSM d'origine des données modifiées (« prod » si absent). */
	server?: 'prod' | 'dev';
	/** Conflit détecté à l'envoi : la saisie est « à revoir » et n'est plus envoyée. */
	conflict?: string;
	/** Faite en mode démonstration (hors de la gare) : jamais envoyée sur la vraie carte. */
	demo?: boolean;
	/** Pays de la gare (lot P1). Absent dans les saisies plus anciennes : France (recordCountry). */
	country?: CountryCode;
}

/** Ajoute, change ou retire des tags d'un objet existant (null = retirer le tag). */
export interface TagEdit extends EditBase {
	kind: 'tags';
	target: ElementKey;
	/** Version de l'objet au moment de la saisie (détection des conflits au lot 3). */
	version?: number;
	tags: Record<string, string | null>;
	/** Valeurs des tags modifiés au moment de la saisie (pour détecter un changement entre-temps). */
	base?: Record<string, string | null>;
	/** Résumé lisible pour la liste des contributions (« Voie 3 », « Quai A »…). */
	summary: string;
	/**
	 * Famille de l'objet modifié (lot traduction) : le résumé est rédigé dans la langue de
	 * l'interface, on ne peut plus la déduire de son texte. Absente des saisies plus anciennes
	 * (résumés en français : « Quai… » ou « Voie… »).
	 */
	family?: 'quai' | 'voie';
	/**
	 * Quai en plusieurs parties : autres parties qui reçoivent les mêmes tags, dans le même
	 * envoi (un <modify> par partie). La saisie part entière ou pas du tout : si l'une des
	 * parties a changé entre-temps, toute la saisie passe « à revoir » (numéros cohérents).
	 */
	parts?: TagPart[];
	/** Nom du quai entier (« Quai voies 3 »), pour le commentaire du changeset. */
	name?: string;
}

/** Autre partie d'un quai visée par une saisie de tags (version et valeurs d'origine). */
export interface TagPart {
	target: ElementKey;
	version?: number;
	base?: Record<string, string | null>;
}

/** Objets visés par une saisie de tags : l'objet, puis les autres parties du même quai. */
export const tagTargets = (e: TagEdit): TagPart[] => [
	{ target: e.target, version: e.version, base: e.base },
	...(e.parts ?? [])
];

/** Nouvelle pancarte : nœud inséré dans le way de la voie, entre deux nœuds existants. */
export interface NewNodeEdit extends EditBase {
	kind: 'node';
	/** Identifiant négatif provisoire (convention OSM pour un objet à créer). */
	tempId: number;
	lon: number;
	lat: number;
	way: number;
	wayVersion?: number;
	/** Le nœud est inséré après le nœud d'indice `after` du way. */
	after: number;
	/** Identifiant de ce nœud voisin (retrouve la place même si le way a changé entre-temps). */
	afterNode?: number;
	tags: Tags;
	summary: string;
}

/** Nouveau quai dessiné (E11) : contour fermé de nœuds nouveaux, jamais partagés avec une voie. */
export interface NewWayEdit extends EditBase {
	kind: 'way';
	/** Identifiant négatif provisoire du way. */
	tempId: number;
	/** Nœuds du contour, dans l'ordre, sans répéter le premier (identifiants négatifs). */
	nodes: { id: number; lon: number; lat: number }[];
	tags: Tags;
	summary: string;
}

/** Point d'un contour de quai : nœud existant (id > 0) ou nouveau (id < 0). */
export interface RingNode {
	id: number;
	lon: number;
	lat: number;
}

/** Nœud du quai tel qu'il était sur OpenStreetMap au moment de la saisie (lot 7). */
export interface OrigNode extends RingNode {
	version?: number;
	/**
	 * Ni déplacé ni retiré. Depuis le lot 7c : seulement un point répété dans le contour.
	 * (Saisies plus anciennes : tout point relié ; elles ne l'ont jamais déplacé ni retiré.)
	 */
	locked: boolean;
	/**
	 * Relié à d'autres objets (autre way, tags propres, relation) — lot 7c : déplaçable (c'est
	 * le même nœud : les objets qui le partagent suivent) ; retiré, il quitte seulement ce quai.
	 */
	shared?: boolean;
	/**
	 * Partagé avec au moins un bord de quai (railway=platform_edge) : déplaçable (le bord suit),
	 * jamais retiré du contour (le bord deviendrait incohérent avec le quai).
	 */
	edge?: boolean;
	/** À quoi le nœud est relié, en clair (« bord du quai », « toit »…), pour l'expliquer. */
	links?: string[];
	/** Objets (ways) qui partagent ce nœud, en clair (« gare », « toit »), sans doublon. */
	ways?: string[];
	/** Ce que le nœud est lui-même s'il porte des tags (« ascenseur », « entrée »…). */
	tag?: string;
}

/**
 * Forme d'un quai existant corrigée (E12) : le way garde son identifiant (historique et
 * relations conservés), seule sa liste de nœuds change. « area » : quai tracé en ligne
 * redessiné en surface (contour fermé, area=yes ajouté).
 */
export interface ShapeEdit extends EditBase {
	kind: 'shape';
	target: `way/${number}`;
	/** Version du way au moment de la saisie : toute autre version à l'envoi → « à revoir ». */
	version?: number;
	mode: 'reshape' | 'area';
	/** Nœuds d'origine, dans l'ordre, sans répéter le premier d'un contour fermé. */
	before: OrigNode[];
	/** Nouveau contour fermé, sans répéter le premier point. */
	nodes: RingNode[];
	/** Tags saisis sur la fiche du même quai, envoyés dans la même modification du way. */
	tags?: Record<string, string | null>;
	base?: Record<string, string | null>;
	/** Nom du quai (« Quai A »), pour les résumés. */
	name: string;
	/** Résumés séparés de la forme et des tags ; `summary` les réunit. */
	shapeSummary: string;
	tagSummary?: string;
	summary: string;
}

/** Relation dont un quai supprimé est retiré (zone d'arrêt, ligne…). */
export interface RelationRef {
	id: number;
	kind: 'stop_area' | 'route' | 'other';
	name: string;
}

/** Suppression d'un quai (way) : ses nœuds devenus orphelins sont supprimés avec lui. */
// (Un nœud relié à d'autres objets, `shared`/`edge`/`locked`, reste : seul le way disparaît.)
export interface DeleteEdit extends EditBase {
	kind: 'delete';
	target: `way/${number}`;
	version?: number;
	/** « duplicate » : en double (permis à distance) ; « gone » : n'existe plus (sur place). */
	reason: 'duplicate' | 'gone';
	before: OrigNode[];
	/** Relations dont le quai est retiré, lues au moment de la saisie (pour le résumé). */
	relations: RelationRef[];
	/** Nom du quai (« Quai A »), pour les résumés et le commentaire du changeset. */
	name: string;
	summary: string;
}

/**
 * Suppression d'une pancarte d'arrêt existante (lot 7d) : nœud retiré de la voie puis
 * supprimé (« remove »), ou gardé dans la voie sans les tags de la pancarte (« untag »).
 * La décision est relue à l'envoi sur les données à jour (sign.ts, planUpload).
 */
export interface SignDeleteEdit extends EditBase {
	kind: 'signdelete';
	target: `node/${number}`;
	/** Version du nœud au moment de la saisie : toute autre version à l'envoi → « à revoir ». */
	version?: number;
	/** Voie qui contient la pancarte (absente si le nœud n'est dans aucun way). */
	way?: number;
	wayVersion?: number;
	/** « gone » : sur place seulement ; « duplicate », « misplaced » : permis à distance. */
	reason: 'gone' | 'duplicate' | 'misplaced';
	/** Décision annoncée à la saisie (le récapitulatif l'a dite à l'utilisateur). */
	mode: 'remove' | 'untag';
	/** Clés retirées en « untag ». */
	untag: string[];
	/** Libellé de la pancarte (« TGV 2 »), pour les résumés et le commentaire du changeset. */
	label: string;
	summary: string;
}

export type Edit = TagEdit | NewNodeEdit | NewWayEdit | ShapeEdit | DeleteEdit | SignDeleteEdit;

/** Saisie qui vise un objet existant par `target` (tags, forme, suppressions). */
export const targets = (e: Edit): e is TagEdit | ShapeEdit | DeleteEdit | SignDeleteEdit =>
	e.kind === 'tags' || e.kind === 'shape' || e.kind === 'delete' || e.kind === 'signdelete';

/** Suppression (quai ou pancarte) : jamais renvoyée telle quelle, elle se refait sur la carte. */
export const isRemoval = (e: Edit): e is DeleteEdit | SignDeleteEdit =>
	e.kind === 'delete' || e.kind === 'signdelete';

/** Clé de l'objet principal d'une saisie (« way/-3 », « node/-1 », « way/123 »). */
export const editKey = (e: Edit): ElementKey =>
	targets(e) ? e.target : e.kind === 'node' ? `node/${e.tempId}` : `way/${e.tempId}`;

/** Applique des changements de tags (null ou vide = retirer). */
export function changeTags(tags: Tags | undefined, changes: Record<string, string | null> = {}) {
	const out: Tags = { ...(tags ?? {}) };
	for (const [k, v] of Object.entries(changes)) {
		if (v === null || v === '') delete out[k];
		else out[k] = v;
	}
	return out;
}

/** Tags ajoutés par un « redessiner en surface ». */
export const AREA_TAGS = { area: 'yes' } as const;

/** Famille d'objet d'une saisie (couleur de la ligne dans les listes E8 et E9). */
export const editFamily = (e: Edit): 'quai' | 'voie' | 'pancarte' =>
	e.kind === 'node' ||
	e.kind === 'signdelete' ||
	(e.kind === 'tags' && e.target.startsWith('node/'))
		? 'pancarte'
		: e.kind !== 'tags' || isPlatformTagEdit(e)
			? 'quai'
			: 'voie';

/** Saisie de tags sur un quai (et non sur une voie) ; saisies d'avant le lot traduction : résumé. */
const isPlatformTagEdit = (e: TagEdit) =>
	(e.family ?? (e.summary.startsWith('Quai') ? 'quai' : 'voie')) === 'quai';

/** Icône d'une saisie : la famille, ou la nature du changement pour un quai existant. */
export const editIcon = (e: Edit) =>
	e.kind === 'shape' ? 'shape' : isRemoval(e) ? 'trash' : editFamily(e);

/** Nature d'une saisie, en clair (« Forme du quai », « Suppression »…). */
export function editLabel(e: Edit) {
	if (e.kind === 'node') return tr('edit.label.newSign');
	if (e.kind === 'way') return tr('edit.label.newPlatform');
	if (e.kind === 'shape') return e.mode === 'area' ? tr('edit.label.area') : tr('edit.label.shape');
	if (e.kind === 'delete')
		return tr('edit.label.delete', { why: tk(`shape.reasonComment.${e.reason}`) });
	if (e.kind === 'signdelete')
		return tr('edit.label.signDelete', { why: tk(`sign.reasonInline.${e.reason}`) });
	return tr('edit.label.tags');
}

export const newEditId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Range une nouvelle saisie parmi les saisies en attente (`list`, même serveur) :
 * - tags d'un objet pas encore envoyé → dans la saisie qui le crée ;
 * - tags d'un objet déjà saisi → fusion avec la saisie précédente ;
 * - quai existant (lot 7) : forme et tags dans une seule saisie (un seul <modify> du way) ;
 *   une suppression remplace toutes les autres saisies sur ce quai ;
 *   des tags sur un quai marqué à supprimer sont refusés (exception) ;
 * - pancarte existante (lot 7d) : même règle, la suppression remplace ses saisies de tags.
 * Renvoie la saisie à enregistrer et les identifiants des saisies à retirer.
 */
export function mergeEdit(list: Edit[], edit: Edit): { edit?: Edit; drop: string[] } {
	if (edit.kind === 'tags' && Number(edit.target.split('/')[1]) < 0) {
		const target = edit.target;
		const creator = list.find(
			(e) => (e.kind === 'node' || e.kind === 'way') && editKey(e) === target
		);
		if (!creator || (creator.kind !== 'node' && creator.kind !== 'way')) return { drop: [] };
		const summary = isPlatformTagEdit(edit)
			? tr('edit.drawnSummary', { summary: edit.summary })
			: creator.summary;
		return {
			edit: {
				...creator,
				tags: changeTags(creator.tags, edit.tags),
				summary,
				...(edit.demo ? { demo: true } : {})
			},
			drop: []
		};
	}
	const onTarget = (target: string) => list.filter((e) => targets(e) && e.target === target);
	const drop: string[] = [];
	if (edit.kind === 'tags' && edit.target.startsWith('node/')) {
		if (onTarget(edit.target).some((e) => e.kind === 'signdelete' && !e.conflict))
			throw new Error(tr('edit.error.signDeleted'));
	}
	if (edit.kind === 'signdelete') return { edit, drop: onTarget(edit.target).map((e) => e.id) };
	if (edit.kind === 'tags' && edit.target.startsWith('way/')) {
		const others = onTarget(edit.target);
		if (others.some((e) => e.kind === 'delete' && !e.conflict))
			throw new Error(tr('edit.error.platformDeleted'));
		const shape = others.find((e) => e.kind === 'shape' && !e.conflict);
		// (Saisie sur toutes les parties d'un quai : gardée à part, elle vise plusieurs ways.)
		if (shape?.kind === 'shape' && !edit.parts?.length)
			return { edit: withTags(shape, edit), drop: [] };
	}
	if (edit.kind === 'shape') {
		// Une saisie de numéros sur toutes les parties d'un quai reste à part (plusieurs ways).
		const others = onTarget(edit.target).filter((o) => !(o.kind === 'tags' && o.parts?.length));
		for (const o of others)
			if (o.kind === 'tags') edit = withTags(edit, o);
			else if (o.kind === 'shape' && o.tags)
				edit = withTags(edit, { tags: o.tags, base: o.base, summary: o.tagSummary ?? '' });
		drop.push(...others.map((e) => e.id));
		return { edit, drop };
	}
	if (edit.kind === 'delete') return { edit, drop: onTarget(edit.target).map((e) => e.id) };

	const e = edit;
	const same =
		e.kind === 'tags'
			? list.find((x) => x.kind === 'tags' && x.target === e.target)
			: list.find(
					(x) =>
						(x.kind === 'node' || x.kind === 'way') && x.kind === e.kind && x.tempId === e.tempId
				);
	if (same?.kind === 'tags' && e.kind === 'tags')
		// Fusion : la nouvelle saisie complète la précédente sur le même objet.
		return {
			edit: {
				...e,
				id: same.id,
				tags: { ...same.tags, ...e.tags },
				base: { ...e.base, ...same.base },
				version: same.version ?? e.version,
				...mergeParts(same.parts, e.parts),
				...((e.name ?? same.name) ? { name: e.name ?? same.name } : {})
			},
			drop
		};
	return { edit: same ? { ...e, id: same.id } : e, drop };
}

/**
 * Parties d'une saisie fusionnée : celles de la nouvelle saisie, avec la version et les valeurs
 * d'origine de la saisie précédente quand elle visait déjà la même partie.
 */
function mergeParts(before?: TagPart[], now?: TagPart[]): { parts?: TagPart[] } {
	if (!before?.length && !now?.length) return {};
	const old = new Map((before ?? []).map((p) => [p.target, p]));
	const out = new Map(old);
	for (const p of now ?? []) {
		const o = old.get(p.target);
		out.set(
			p.target,
			o ? { ...p, version: o.version ?? p.version, base: { ...p.base, ...o.base } } : p
		);
	}
	return { parts: [...out.values()] };
}

/** Range des tags saisis sur la fiche d'un quai dans sa saisie de forme. */
function withTags(
	shape: ShapeEdit,
	t: {
		tags: Record<string, string | null>;
		base?: Record<string, string | null>;
		summary: string;
		demo?: boolean;
	}
): ShapeEdit {
	const tagSummary = t.summary || shape.tagSummary;
	return {
		...shape,
		tags: { ...shape.tags, ...t.tags },
		base: { ...t.base, ...shape.base },
		tagSummary,
		summary: tagSummary ? `${shape.shapeSummary} ; ${tagSummary}` : shape.shapeSummary,
		...(t.demo || shape.demo ? { demo: true } : {})
	};
}

/** Applique les modifications locales aux éléments OSM, sans modifier l'original. */
export function applyEdits(elements: OsmElement[], edits: Edit[]): OsmElement[] {
	if (!edits.length) return elements;
	const byKey = new Map<string, OsmElement>();
	for (const e of elements) byKey.set(`${e.type}/${e.id}`, e);
	const out = new Map(byKey);

	for (const ed of edits) {
		if (ed.kind === 'tags') {
			// L'objet, et les autres parties du même quai s'il y en a.
			for (const { target } of tagTargets(ed)) {
				const e = out.get(target);
				if (e) out.set(target, { ...e, tags: changeTags(e.tags, ed.tags) } as OsmElement);
			}
		} else if (ed.kind === 'shape') {
			const w = out.get(ed.target) as OsmWay | undefined;
			if (!w || !ed.nodes.length) continue;
			for (const n of ed.nodes) {
				const prev = out.get(`node/${n.id}`) as OsmNode | undefined;
				out.set(
					`node/${n.id}`,
					prev
						? { ...prev, lon: n.lon, lat: n.lat }
						: { type: 'node', id: n.id, lon: n.lon, lat: n.lat }
				);
			}
			const ids = ed.nodes.map((n) => n.id);
			let tags = changeTags(w.tags, ed.tags);
			if (ed.mode === 'area') tags = { ...tags, ...AREA_TAGS };
			out.set(ed.target, { ...w, nodes: [...ids, ids[0]], tags });
		} else if (ed.kind === 'delete') {
			// Le quai disparaît de la vue locale, et des relations qui le contenaient.
			if (!out.delete(ed.target)) continue;
			const id = Number(ed.target.split('/')[1]);
			for (const [k, e] of out)
				if (e.type === 'relation' && e.members.some((m) => m.type === 'way' && m.ref === id))
					out.set(k, {
						...e,
						members: e.members.filter((m) => !(m.type === 'way' && m.ref === id))
					});
		} else if (ed.kind === 'signdelete') {
			// La pancarte disparaît de la vue locale : nœud retiré de la voie, ou tags retirés.
			const n = out.get(ed.target) as OsmNode | undefined;
			if (!n) continue;
			const id = n.id;
			if (ed.mode === 'untag') {
				const tags = { ...(n.tags ?? {}) };
				for (const k of ed.untag) delete tags[k];
				out.set(ed.target, { ...n, tags });
				continue;
			}
			out.delete(ed.target);
			for (const [k, e] of out)
				if (e.type === 'way' && e.nodes.includes(id))
					out.set(k, { ...e, nodes: e.nodes.filter((x) => x !== id) });
		} else if (ed.kind === 'way') {
			for (const n of ed.nodes)
				out.set(`node/${n.id}`, { type: 'node', id: n.id, lon: n.lon, lat: n.lat });
			const ids = ed.nodes.map((n) => n.id);
			out.set(`way/${ed.tempId}`, {
				type: 'way',
				id: ed.tempId,
				nodes: [...ids, ids[0]],
				tags: ed.tags
			});
		} else {
			const w = out.get(`way/${ed.way}`) as OsmWay | undefined;
			if (!w) continue;
			const node: OsmNode = {
				type: 'node',
				id: ed.tempId,
				lat: ed.lat,
				lon: ed.lon,
				tags: ed.tags
			};
			out.set(`node/${ed.tempId}`, node);
			// Retrouve la place du nœud par son voisin (les indices peuvent avoir bougé).
			const nodes = [...w.nodes];
			const prev = (byKey.get(`way/${ed.way}`) as OsmWay).nodes[ed.after];
			const at = nodes.indexOf(prev);
			nodes.splice(at < 0 ? ed.after + 1 : at + 1, 0, ed.tempId);
			out.set(`way/${ed.way}`, { ...w, nodes });
		}
	}
	return [...out.values()];
}

// ---------- Accrochage sur une voie ----------

export interface Snap {
	way: number;
	/** Indice du nœud après lequel insérer. */
	after: number;
	lon: number;
	lat: number;
	/** Distance (m) entre le point visé et la voie. */
	distM: number;
	/** Cap de la voie au point d'accrochage, en degrés (0 = nord, 90 = est), dans le sens du way. */
	bearing: number;
}

/** Point le plus proche sur les voies candidates, si à moins de `maxM` mètres. */
export function snapToTracks(
	lon: number,
	lat: number,
	ways: OsmWay[],
	nodeOf: (id: number) => OsmNode | undefined,
	maxM = 3
): Snap | undefined {
	const proj = new LocalProjection(lon, lat);
	const p: Pt = { x: 0, y: 0 };
	let best: Snap | undefined;
	for (const w of ways) {
		for (let i = 0; i + 1 < w.nodes.length; i++) {
			const a = nodeOf(w.nodes[i]),
				b = nodeOf(w.nodes[i + 1]);
			if (!a || !b) continue;
			const A = proj.project(a.lon, a.lat),
				B = proj.project(b.lon, b.lat);
			const { point } = projectOnSegment(p, A, B);
			const d = Math.hypot(point.x, point.y);
			if (d > maxM || (best && d >= best.distM)) continue;
			const [plon, plat] = proj.unproject(point);
			const bearing = (Math.atan2(B.x - A.x, B.y - A.y) * 180) / Math.PI;
			best = {
				way: w.id,
				after: i,
				lon: plon,
				lat: plat,
				distM: d,
				bearing: (bearing + 360) % 360
			};
		}
	}
	return best;
}

const BEARINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

/** Direction (8 points cardinaux) d'un cap : « n », « ne »… */
export const bearingCode = (deg: number) =>
	BEARINGS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Nom d'une direction à partir d'un cap (« nord-est »), dans la langue de l'interface. */
export function bearingName(deg: number) {
	return tr(`bearing.${bearingCode(deg)}`);
}

// ---------- Numéros ----------

/**
 * Nettoie un numéro de voie saisi : « Voie 3 » → « 3 », « v 1bis » → « 1bis ». Le mot « voie »
 * est reconnu dans chaque langue de l'interface (track, Gleis, binario, vía).
 */
export function cleanTrackRef(v: string) {
	return v
		.trim()
		.replace(/^(voie|v|track|gleis|gl|binario|bin|v[ií]a)\.?\s*/i, '')
		.replace(/\s+/g, ' ')
		.slice(0, 12);
}

/** Valeur OSM multiple à partir d'une liste (« 1;2 »), sans doublon, triée naturellement. */
export function joinRefs(values: string[]) {
	const clean = [...new Set(values.map(cleanTrackRef).filter(Boolean))];
	// Ordre de la valeur OSM : le même quelle que soit la langue de l'interface.
	clean.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
	return clean.join(';');
}

/** Date du jour au format OSM (check_date=AAAA-MM-JJ). */
export const today = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
