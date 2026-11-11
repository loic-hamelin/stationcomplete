// Préparation de l'envoi vers OpenStreetMap (API 0.6) : rebasage des saisies sur les versions
// à jour, détection des conflits, et fabrication des documents XML (changeset, osmChange).
// Code pur, testé sans réseau.

import {
	AREA_TAGS,
	changeTags,
	type DeleteEdit,
	type Edit,
	type NewNodeEdit,
	type NewWayEdit,
	type OrigNode,
	type ShapeEdit,
	type SignDeleteEdit,
	type TagEdit,
	tagTargets
} from './edits';
import { DEFAULT_COUNTRY, imageryOf, type CountryCode } from './countries';
import type { BBox, OsmElement, OsmNode, OsmRelation, OsmWay, Tags } from './osm';
import { locale, t as tr, tk } from '../i18n/t.ts';
import { complexText, followers, followersPhrase, hasTags, isLinked, shapeDiff } from './shape';
import { signRemoval, withoutSign } from './sign';

export interface Plan {
	/** Objets à créer : nœuds d'abord, puis ways (quais dessinés). */
	create: (OsmNode | OsmWay)[];
	modify: OsmElement[];
	/** Objets à supprimer : ways d'abord, puis nœuds (ordre exigé par l'API). */
	delete: OsmElement[];
	/** Saisies qui partent dans ce changeset. */
	sent: string[];
	/** Saisies écartées, avec la raison (affichée « à revoir »). */
	conflicts: { id: string; reason: string }[];
	/** Objets touchés par chaque saisie envoyée (« way/12 »…), pour attribuer un refus du serveur. */
	touched: Record<string, string[]>;
}

const key = (e: { type: string; id: number }) => `${e.type}/${e.id}`;
const wayId = (target: string) => Number(target.split('/')[1]);

/** Identifiants des objets à relire sur le serveur juste avant l'envoi. */
export function elementsToFetch(edits: Edit[]) {
	const nodes = new Set<number>(),
		ways = new Set<number>(),
		relations = new Set<number>();
	for (const e of edits) {
		if (e.kind === 'node') ways.add(e.way);
		else if (e.kind === 'way')
			continue; // quai dessiné : rien à relire, tout est nouveau
		else
			for (const target of e.kind === 'tags' ? tagTargets(e).map((p) => p.target) : [e.target]) {
				const [type, id] = target.split('/');
				(type === 'node' ? nodes : type === 'way' ? ways : relations).add(Number(id));
			}
	}
	return { nodes: [...nodes], ways: [...ways], relations: [...relations] };
}

/**
 * Nœuds dont il faut connaître l'usage à jour (ways, relations) avant l'envoi : les nœuds
 * d'origine des quais modifiés en forme ou supprimés, groupés par saisie, avec l'emprise
 * (+ 10 m) qui les contient. Une lecture /map de cette emprise renvoie, pour chacun d'eux,
 * tous les ways qui l'utilisent et toutes les relations qui le contiennent.
 */
export function usageToCheck(edits: Edit[]) {
	const out: { edit: string; nodes: number[]; bbox: BBox }[] = [];
	for (const e of edits) {
		if (e.kind !== 'shape' && e.kind !== 'delete') continue;
		if (!e.before.length) continue;
		const lons = e.before.map((n) => n.lon),
			lats = e.before.map((n) => n.lat);
		const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
		const dLat = 10 / 111_320,
			dLon = 10 / (111_320 * Math.cos((lat * Math.PI) / 180));
		out.push({
			edit: e.id,
			nodes: e.before.map((n) => n.id),
			bbox: [
				Math.min(...lons) - dLon,
				Math.min(...lats) - dLat,
				Math.max(...lons) + dLon,
				Math.max(...lats) + dLat
			]
		});
	}
	return out;
}

/**
 * Pancartes à supprimer (lot 7d) : avant l'envoi on relit la voie complète (way et nœuds :
 * versions et alignement), puis tous les ways et relations du nœud (usage à jour).
 */
export const signsToCheck = (edits: Edit[]) =>
	edits
		.filter((e): e is SignDeleteEdit => e.kind === 'signdelete')
		.map((e) => ({ node: Number(e.target.split('/')[1]), way: e.way }));

/** Ways quais supprimés (leurs relations sont relues explicitement avant l'envoi). */
export const deletedWays = (edits: Edit[]) =>
	edits.filter((e): e is DeleteEdit => e.kind === 'delete').map((e) => wayId(e.target));

// Motifs des conflits, enregistrés avec la saisie « à revoir » (dans la langue de l'interface au
// moment de l'envoi).
const CHANGED = () => tr('upload.conflict.changed');
const SIGN_CHANGED = () => tr('upload.conflict.signChanged');
const SIGN_LINKED = () => tr('upload.conflict.signLinked');
const NODE_CHANGED = () => tr('upload.conflict.nodeChanged');

/**
 * Applique les saisies aux versions à jour lues sur le serveur.
 * Une saisie est écartée si l'objet a disparu, ou si quelqu'un a changé entre-temps un tag
 * qu'elle modifie (on ne réécrit jamais le travail d'un autre sans relecture humaine).
 * Pour les formes et les suppressions de quai, `fresh` doit contenir, pour chaque nœud
 * d'origine, tous les ways et relations qui l'utilisent (voir usageToCheck).
 */
export function planUpload(edits: Edit[], fresh: OsmElement[]): Plan {
	const byKey = new Map(fresh.map((e) => [key(e), structuredClone(e)]));
	const modified = new Set<string>();
	const plan: Plan = { create: [], modify: [], delete: [], sent: [], conflicts: [], touched: {} };

	// Données relues telles quelles (les décisions de suppression de pancarte s'y fondent).
	const raw = new Map(fresh.map((e) => [key(e), e]));
	// Usage à jour des nœuds (d'après les données relues, avant toute modification).
	const waysOf = new Map<number, Set<number>>();
	const relationsOf = new Map<string, OsmRelation[]>();
	for (const e of fresh) {
		if (e.type === 'way')
			for (const n of e.nodes) {
				if (!waysOf.has(n)) waysOf.set(n, new Set());
				waysOf.get(n)!.add(e.id);
			}
		else if (e.type === 'relation')
			for (const m of e.members) {
				const k = `${m.type}/${m.ref}`;
				relationsOf.set(k, [...(relationsOf.get(k) ?? []), e]);
			}
	}
	/** Nœud libre sur le serveur : sans tag, dans aucun autre way, dans aucune relation. */
	const freeNow = (id: number, owners: number[]) => {
		const n = byKey.get(`node/${id}`) as OsmNode | undefined;
		if (!n) return undefined;
		const others = [...(waysOf.get(id) ?? [])].filter((w) => !owners.includes(w));
		return !hasTags(n.tags) && !others.length && !(relationsOf.get(`node/${id}`) ?? []).length
			? n
			: undefined;
	};
	const sameVersion = (n: OsmNode, o?: OrigNode) =>
		o?.version === undefined || n.version === o.version;
	const conflict = (id: string, reason: string) => plan.conflicts.push({ id, reason });
	const sent = (id: string, touched: string[]) => {
		plan.sent.push(id);
		plan.touched[id] = touched;
	};

	// Tags : l'objet, et pour un quai en plusieurs parties chacune d'elles. Tout ou rien : si une
	// partie a disparu ou changé entre-temps, toute la saisie est « à revoir » (les parties d'un
	// quai ne doivent pas se retrouver avec des numéros différents).
	for (const ed of edits.filter((e): e is TagEdit => e.kind === 'tags')) {
		const all = tagTargets(ed);
		const many = all.length > 1;
		let reason = '';
		for (const p of all) {
			const el = byKey.get(p.target);
			if (!el) {
				reason = many ? tr('upload.conflict.partGone') : tr('upload.conflict.gone');
				break;
			}
			const tags: Tags = el.tags ?? {};
			let clash = '';
			if (p.version !== undefined && el.version !== p.version)
				for (const [k, v] of Object.entries(ed.tags)) {
					const now = tags[k] ?? null;
					const before = p.base ? (p.base[k] ?? null) : now;
					if (now !== before && now !== (v || null)) clash = k;
				}
			if (clash) {
				reason = many
					? tr('upload.conflict.partClash', { key: clash })
					: tr('upload.conflict.clash', { key: clash });
				break;
			}
		}
		if (reason) {
			conflict(ed.id, reason);
			continue;
		}
		for (const p of all) {
			const el = byKey.get(p.target)!;
			el.tags = changeTags(el.tags, ed.tags);
			modified.add(p.target);
		}
		sent(
			ed.id,
			all.map((p) => p.target)
		);
	}

	for (const ed of edits.filter((e): e is NewNodeEdit => e.kind === 'node')) {
		const w = byKey.get(`way/${ed.way}`) as OsmWay | undefined;
		if (!w) {
			conflict(ed.id, tr('upload.conflict.trackGone'));
			continue;
		}
		// Retrouve la place par le nœud voisin ; à défaut, par l'indice si la voie n'a pas bougé.
		let at = ed.afterNode !== undefined ? w.nodes.indexOf(ed.afterNode) : -1;
		if (at < 0 && (ed.wayVersion === undefined || ed.wayVersion === w.version)) at = ed.after;
		if (at < 0 || at >= w.nodes.length - 1) {
			conflict(ed.id, tr('upload.conflict.trackRedrawn'));
			continue;
		}
		w.nodes = [...w.nodes.slice(0, at + 1), ed.tempId, ...w.nodes.slice(at + 1)];
		plan.create.push({ type: 'node', id: ed.tempId, lat: ed.lat, lon: ed.lon, tags: ed.tags });
		modified.add(key(w));
		sent(ed.id, [key(w)]);
	}

	// Formes de quais corrigées : même way, nouvelle liste de nœuds (lot 7).
	const deleteNodes: OsmNode[] = [];
	const deleteWays: OsmWay[] = [];
	for (const ed of edits.filter((e): e is ShapeEdit => e.kind === 'shape')) {
		const w = byKey.get(ed.target) as OsmWay | undefined;
		if (!w) {
			conflict(ed.id, tr('upload.conflict.platformGone'));
			continue;
		}
		if (ed.version !== undefined && w.version !== ed.version) {
			conflict(ed.id, CHANGED());
			continue;
		}
		const id = wayId(ed.target);
		if (
			w.tags?.type === 'multipolygon' ||
			(relationsOf.get(ed.target) ?? []).some((r) => r.tags?.type === 'multipolygon')
		) {
			conflict(ed.id, complexText());
			continue;
		}
		const d = shapeDiff(ed.before, ed.nodes);
		const orig = new Map(ed.before.map((n) => [n.id, n]));
		if (
			ed.nodes.length < 3 ||
			d.foreign.length ||
			new Set(ed.nodes.map((n) => n.id)).size !== ed.nodes.length
		) {
			conflict(ed.id, tr('upload.conflict.ringInvalid'));
			continue;
		}
		// Nœuds déplacés (lot 7c) : libres ou partagés — c'est le même nœud, les objets qui le
		// partagent suivent ; seule sa version doit être inchangée sur le serveur.
		// Nœuds retirés : seulement retirés du way ; supprimés s'ils sont orphelins et sans tag
		// sur le serveur (sinon gardés, sans « à revoir »). Un point de bord de quai n'est jamais
		// retiré (ni déplacé en « redessiner en surface », où les points reliés restent fixes).
		const edgeNow = (nid: number) =>
			[...(waysOf.get(nid) ?? [])].some(
				(w) =>
					w !== id &&
					(byKey.get(`way/${w}`) as OsmWay | undefined)?.tags?.railway === 'platform_edge'
			);
		if (
			d.removed.some((o) => o.edge || edgeNow(o.id)) ||
			d.moved.some((n) => orig.get(n.id)!.locked) ||
			(ed.mode === 'area' && d.moved.some((n) => isLinked(orig.get(n.id)!)))
		) {
			conflict(ed.id, tr('upload.conflict.ringLocks'));
			continue;
		}
		let ok = true;
		const moves: OsmNode[] = [];
		const drops: OsmNode[] = [];
		for (const n of d.moved) {
			const now = byKey.get(`node/${n.id}`) as OsmNode | undefined;
			if (!now || !sameVersion(now, orig.get(n.id))) ok = false;
			else moves.push({ ...now, lon: n.lon, lat: n.lat });
		}
		for (const o of d.removed) {
			const now = freeNow(o.id, [id]);
			if (now && sameVersion(now, o)) drops.push(now);
		}
		if (!ok) {
			conflict(ed.id, NODE_CHANGED());
			continue;
		}
		for (const n of moves) {
			byKey.set(key(n), n);
			modified.add(key(n));
		}
		for (const n of d.added) plan.create.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon });
		const ids = ed.nodes.map((n) => n.id);
		const nodes = [...ids, ids[0]];
		let tags = changeTags(w.tags, ed.tags);
		if (ed.mode === 'area') tags = { ...tags, ...AREA_TAGS };
		// Way modifié seulement si sa liste de nœuds ou ses tags changent (un point déplacé
		// seul ne touche que le nœud : le way et le bord de quai restent intacts).
		if (nodes.join() !== w.nodes.join() || JSON.stringify(tags) !== JSON.stringify(w.tags ?? {})) {
			w.nodes = nodes;
			w.tags = tags;
			modified.add(ed.target);
		}
		deleteNodes.push(...drops);
		sent(ed.id, [ed.target, ...moves.map(key), ...drops.map(key)]);
	}

	// Quais supprimés : way, nœuds orphelins, et retrait des relations qui le contenaient.
	for (const ed of edits.filter((e): e is DeleteEdit => e.kind === 'delete')) {
		const w = byKey.get(ed.target) as OsmWay | undefined;
		if (!w) {
			conflict(ed.id, tr('upload.conflict.platformDeleted'));
			continue;
		}
		if (ed.version !== undefined && w.version !== ed.version) {
			conflict(ed.id, CHANGED());
			continue;
		}
		const id = wayId(ed.target);
		const parents = (relationsOf.get(ed.target) ?? []).map((r) => byKey.get(key(r)) as OsmRelation);
		if (w.tags?.type === 'multipolygon' || parents.some((r) => r.tags?.type === 'multipolygon')) {
			conflict(ed.id, complexText());
			continue;
		}
		const emptied = parents.find((r) => r.members.every((m) => m.type === 'way' && m.ref === id));
		if (emptied) {
			conflict(
				ed.id,
				tr('upload.conflict.relationEmpty', { name: emptied.tags?.name ?? emptied.id })
			);
			continue;
		}
		const orig = new Map(ed.before.map((n) => [n.id, n]));
		let ok = true;
		const drops: OsmNode[] = [];
		for (const n of new Set(w.nodes)) {
			const o = orig.get(n);
			const now = freeNow(n, [id]);
			if (now && sameVersion(now, o)) drops.push(now);
			// Nœud libre à la saisie, devenu relié ou modifié depuis : on ne décide pas à l'aveugle.
			// (Relié à la saisie, bord de quai compris : il reste, seul le way disparaît.)
			else if (!o || !isLinked(o)) ok = false;
		}
		if (!ok) {
			conflict(ed.id, NODE_CHANGED());
			continue;
		}
		for (const r of parents) {
			r.members = r.members.filter((m) => !(m.type === 'way' && m.ref === id));
			modified.add(key(r));
		}
		deleteWays.push(w);
		deleteNodes.push(...drops);
		sent(ed.id, [ed.target, ...parents.map(key), ...drops.map(key)]);
	}

	// Pancartes supprimées (lot 7d) : nœud retiré de la voie puis supprimé, ou tags retirés.
	// La géométrie de la voie ne change jamais (écart < 0,3 m, sinon le nœud est gardé).
	for (const ed of edits.filter((e): e is SignDeleteEdit => e.kind === 'signdelete')) {
		const n = raw.get(ed.target) as OsmNode | undefined;
		const now = byKey.get(ed.target) as OsmNode | undefined;
		if (!n || !now) {
			conflict(ed.id, tr('upload.conflict.signDeleted'));
			continue;
		}
		if (ed.version !== undefined && n.version !== ed.version) {
			conflict(ed.id, SIGN_CHANGED());
			continue;
		}
		if (ed.way !== undefined) {
			const w = raw.get(`way/${ed.way}`) as OsmWay | undefined;
			if (!w || !w.nodes.includes(n.id)) {
				conflict(ed.id, tr('upload.conflict.signTrack'));
				continue;
			}
			if (ed.wayVersion !== undefined && w.version !== ed.wayVersion) {
				conflict(ed.id, SIGN_CHANGED());
				continue;
			}
		}
		const ways = [...(waysOf.get(n.id) ?? [])]
			.map((id) => raw.get(`way/${id}`) as OsmWay | undefined)
			.filter((w): w is OsmWay => !!w);
		const r = signRemoval(
			n,
			ways,
			relationsOf.get(ed.target) ?? [],
			(id) => raw.get(`node/${id}`) as OsmNode | undefined
		);
		if (ed.mode === 'remove' && r.mode !== 'remove') {
			// Annoncé « retiré de la voie » : on ne décide pas autre chose à l'aveugle.
			conflict(ed.id, SIGN_LINKED());
			continue;
		}
		if (ed.mode === 'remove') {
			const touched: string[] = [ed.target];
			if (r.way !== undefined) {
				const w = byKey.get(`way/${r.way}`) as OsmWay;
				w.nodes = w.nodes.filter((x) => x !== n.id);
				modified.add(key(w));
				touched.unshift(key(w));
			}
			deleteNodes.push(now);
			sent(ed.id, touched);
		} else {
			// Nœud gardé : seuls les tags de la pancarte partent (relus : la version est la même).
			const keys = Object.keys(n.tags ?? {}).filter((k) => ed.untag.includes(k));
			now.tags = withoutSign(now.tags, keys);
			modified.add(ed.target);
			sent(ed.id, [ed.target]);
		}
	}

	// Quais dessinés : nœuds puis way fermé, tous nouveaux.
	const newWays: OsmWay[] = [];
	for (const ed of edits.filter((e): e is NewWayEdit => e.kind === 'way')) {
		if (ed.nodes.length < 3) {
			conflict(ed.id, tr('upload.conflict.ringIncomplete'));
			continue;
		}
		for (const n of ed.nodes) plan.create.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon });
		const ids = ed.nodes.map((n) => n.id);
		newWays.push({ type: 'way', id: ed.tempId, nodes: [...ids, ids[0]], tags: ed.tags });
		sent(ed.id, [`way/${ed.tempId}`]);
	}
	// Les ways créés viennent après tous les nœuds créés (ordre exigé par l'API).
	plan.create.push(...newWays);

	const gone = new Set([...deleteWays, ...deleteNodes].map(key));
	plan.modify = [...modified].filter((k) => !gone.has(k)).map((k) => byKey.get(k)!);
	plan.delete = [...deleteWays, ...new Map(deleteNodes.map((n) => [n.id, n])).values()];
	return plan;
}

/**
 * Commentaire proposé pour le changeset d'une gare, d'après les saisies : le motif d'une
 * suppression y figure toujours (transparence envers les autres contributeurs).
 */
export function proposedComment(stationName: string, edits: Edit[]) {
	const parts: string[] = [];
	if (edits.some((e) => (e.kind === 'tags' && !e.parts?.length) || e.kind === 'node'))
		parts.push(tr('upload.comment.numbers'));
	// Quai en plusieurs parties : le commentaire dit que chaque partie reçoit le même numéro.
	for (const e of edits)
		if (e.kind === 'tags' && e.parts?.length)
			parts.push(
				tr('upload.comment.parts', {
					name: e.name ?? e.summary,
					count: e.parts.length + 1
				})
			);
	if (edits.some((e) => e.kind === 'way')) parts.push(tr('upload.comment.drawn'));
	const shapes = edits.filter((e): e is ShapeEdit => e.kind === 'shape');
	if (shapes.length) {
		// Objets qui ont suivi les points déplacés (lot 7c) : dits aussi dans le commentaire.
		const f = { ways: new Set<string>(), tags: new Set<string>() };
		for (const e of shapes) {
			const one = followers(e.before, e.nodes);
			one.ways.forEach((w) => f.ways.add(w));
			one.tags.forEach((t) => f.tags.add(t));
		}
		const also = followersPhrase({ ways: [...f.ways], tags: [...f.tags] });
		parts.push(tr('upload.comment.shape') + (also ? ` (${also})` : ''));
	}
	for (const e of edits)
		if (e.kind === 'delete')
			parts.push(
				tr('upload.comment.deleted', {
					name: e.name,
					why: tk(`shape.reasonComment.${e.reason}`)
				})
			);
		else if (e.kind === 'signdelete')
			parts.push(
				tr('upload.comment.signDeleted', {
					label: e.label,
					why: tk(`sign.reasonInline.${e.reason}`),
					mode: e.mode
				})
			);
	if (!parts.length) parts.push(tr('upload.comment.numbers'));
	return tr('upload.comment.station', { name: stationName, parts: parts.join(' ; ') });
}

// ---------- XML ----------

const esc = (v: string | number) =>
	String(v)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/\n/g, '&#10;');

const tagsXml = (t: Tags = {}) =>
	Object.entries(t)
		.map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`)
		.join('');

export function changesetXml(tags: Tags) {
	return `<osm><changeset>${tagsXml(tags)}</changeset></osm>`;
}

function elementXml(e: OsmElement, changeset: number, create: boolean) {
	const v = create ? '' : ` version="${e.version}"`;
	const head = `id="${e.id}"${v} changeset="${changeset}"`;
	if (e.type === 'node') {
		const n = e as OsmNode;
		return `<node ${head} lat="${n.lat.toFixed(7)}" lon="${n.lon.toFixed(7)}">${tagsXml(n.tags)}</node>`;
	}
	if (e.type === 'way') {
		const w = e as OsmWay;
		return `<way ${head}>${w.nodes.map((r) => `<nd ref="${r}"/>`).join('')}${tagsXml(w.tags)}</way>`;
	}
	const r = e as OsmRelation;
	const members = r.members
		.map((m) => `<member type="${m.type}" ref="${m.ref}" role="${esc(m.role)}"/>`)
		.join('');
	return `<relation ${head}>${members}${tagsXml(r.tags)}</relation>`;
}

/**
 * osmChange d'un envoi : create → modify → delete (le retrait d'une relation et la nouvelle
 * liste de nœuds d'un way passent avant la suppression des objets qu'ils ne référencent plus).
 * Pas de « if-unused » : l'usage est vérifié avant, et un refus 412 met la saisie « à revoir ».
 */
export function osmChangeXml(
	changeset: number,
	plan: Pick<Plan, 'create' | 'modify'> & Partial<Pick<Plan, 'delete'>>
) {
	const create = plan.create.map((e) => elementXml(e, changeset, true)).join('');
	const modify = plan.modify.map((e) => elementXml(e, changeset, false)).join('');
	const order = { relation: 0, way: 1, node: 2 };
	const del = [...(plan.delete ?? [])]
		.sort((a, b) => order[a.type] - order[b.type])
		.map((e) => elementXml(e, changeset, false))
		.join('');
	return (
		`<osmChange version="0.6" generator="stationcomplete">` +
		(create ? `<create>${create}</create>` : '') +
		(modify ? `<modify>${modify}</modify>` : '') +
		(del ? `<delete>${del}</delete>` : '') +
		`</osmChange>`
	);
}

/** osmChange de création seule (copie d'une gare vers le serveur de test). */
export function osmCreateXml(changeset: number, elements: OsmElement[]) {
	return `<osmChange version="0.6" generator="stationcomplete"><create>${elements
		.map((e) => elementXml(e, changeset, true))
		.join('')}</create></osmChange>`;
}

/**
 * Copie, avec des identifiants provisoires, des quais, des voies et des pancartes d'une gare
 * (relations exclues). Sert uniquement à préparer une gare d'essai sur le serveur de test.
 * Les voies sont coupées à l'emprise de la gare (+ marge) : le serveur limite le nombre de
 * modifications par heure pour les comptes récents, la copie doit rester petite.
 */
export function copyForTest(
	elements: OsmElement[],
	bbox?: BBox,
	opts: { marginM?: number; rails?: Set<number>; toleranceM?: number } = {}
): OsmElement[] {
	const marginM = opts.marginM ?? 30;
	const nodes = new Map<number, OsmNode>();
	for (const e of elements) if (e.type === 'node') nodes.set(e.id, e as OsmNode);
	let inside: (n: OsmNode) => boolean = () => true;
	if (bbox) {
		const dLat = marginM / 111_320;
		const dLon = marginM / (111_320 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180));
		inside = (n) =>
			n.lon >= bbox[0] - dLon &&
			n.lon <= bbox[2] + dLon &&
			n.lat >= bbox[1] - dLat &&
			n.lat <= bbox[3] + dLat;
	}
	// Morceaux de voie à garder : suites de nœuds consécutifs dans l'emprise (≥ 2 nœuds).
	const pieces: { nodes: number[]; tags?: Tags }[] = [];
	for (const e of elements) {
		if (e.type !== 'way') continue;
		const w = e as OsmWay;
		const t = w.tags ?? {};
		if (t.railway === 'platform' || t.public_transport === 'platform') {
			if (w.nodes.some((id) => nodes.has(id) && inside(nodes.get(id)!)))
				pieces.push({ nodes: w.nodes.filter((id) => nodes.has(id)), tags: t });
		} else if (t.railway === 'rail' && (!opts.rails || opts.rails.has(w.id))) {
			let run: number[] = [];
			const flush = () => {
				if (run.length >= 2) pieces.push({ nodes: run, tags: t });
				run = [];
			};
			for (const id of w.nodes) {
				const n = nodes.get(id);
				if (n && inside(n)) run.push(id);
				else flush();
			}
			flush();
		}
	}
	// Quais décrits par une relation (multipolygone) : on recopie le contour extérieur comme un
	// quai simple, avec les tags de la relation.
	const waysById = new Map(
		elements.filter((e): e is OsmWay => e.type === 'way').map((w) => [w.id, w])
	);
	for (const e of elements) {
		if (e.type !== 'relation') continue;
		const r = e as OsmRelation;
		const t = r.tags ?? {};
		if (t.railway !== 'platform' && t.public_transport !== 'platform') continue;
		for (const m of r.members) {
			const w = m.type === 'way' && m.role !== 'inner' ? waysById.get(m.ref) : undefined;
			if (w && w.nodes.some((id) => nodes.has(id) && inside(nodes.get(id)!)))
				pieces.push({
					nodes: w.nodes.filter((id) => nodes.has(id)),
					tags: {
						...(w.tags ?? {}),
						...Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'type'))
					}
				});
		}
	}
	// Simplification du tracé (Douglas-Peucker) : on garde les extrémités et les nœuds avec tags.
	const tol = opts.toleranceM ?? 0.5;
	const lat0 = bbox ? (bbox[1] + bbox[3]) / 2 : 46;
	const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180),
		ky = 111_320;
	const simplify = (ids: number[]): number[] => {
		if (ids.length <= 2 || tol <= 0) return ids;
		const P = ids.map((id) => nodes.get(id)!);
		const keep = new Set<number>([0, ids.length - 1]);
		P.forEach((n, i) => n.tags && Object.keys(n.tags).length && keep.add(i));
		const anchors = [...keep].sort((a, b) => a - b);
		const dp = (a: number, b: number) => {
			const ax = P[a].lon * kx,
				ay = P[a].lat * ky,
				bx = P[b].lon * kx,
				by = P[b].lat * ky;
			const L = Math.hypot(bx - ax, by - ay) || 1;
			let worst = -1,
				wd = tol;
			for (let i = a + 1; i < b; i++) {
				const d = Math.abs((bx - ax) * (ay - P[i].lat * ky) - (ax - P[i].lon * kx) * (by - ay)) / L;
				if (d > wd) [wd, worst] = [d, i];
			}
			if (worst > 0) {
				keep.add(worst);
				dp(a, worst);
				dp(worst, b);
			}
		};
		for (let i = 0; i + 1 < anchors.length; i++) dp(anchors[i], anchors[i + 1]);
		return ids.filter((_, i) => keep.has(i));
	};
	for (const p of pieces) if (p.tags?.railway === 'rail') p.nodes = simplify(p.nodes);
	const ids = new Map<number, number>();
	let next = -1;
	const out: OsmElement[] = [];
	for (const p of pieces)
		for (const id of p.nodes)
			if (!ids.has(id)) {
				ids.set(id, next--);
				const n = nodes.get(id)!;
				out.push({ type: 'node', id: ids.get(id)!, lat: n.lat, lon: n.lon, tags: n.tags });
			}
	for (const p of pieces)
		if (p.nodes.length >= 2)
			out.push({ type: 'way', id: next--, nodes: p.nodes.map((id) => ids.get(id)!), tags: p.tags });
	return out;
}

/**
 * Correspondance des identifiants provisoires → définitifs, d'après la réponse <diffResult>.
 * Un objet supprimé n'a ni new_id ni new_version : `deleted` vaut alors true.
 */
export function parseDiffResult(xml: string) {
	const out = new Map<string, { newId?: number; version?: number; deleted: boolean }>();
	for (const m of xml.matchAll(/<(node|way|relation)\b([^>]*?)\/?>/g)) {
		const attr = (k: string) => m[2].match(new RegExp(`\\b${k}="(-?\\d+)"`))?.[1];
		const old = attr('old_id');
		if (old === undefined) continue;
		const newId = attr('new_id'),
			version = attr('new_version');
		out.set(`${m[1]}/${old}`, {
			newId: newId === undefined ? undefined : Number(newId),
			version: version === undefined ? undefined : Number(version),
			deleted: newId === undefined
		});
	}
	return out;
}

/**
 * Objet en cause dans une erreur 409/412 de l'API (« … of Way 123 », « Node 5 is still used… »).
 * Renvoie « way/123 » ou undefined.
 */
export function conflictTarget(message: string) {
	const m = message.match(/\b(Node|Way|Relation)\s+(-?\d+)/i);
	return m ? `${m[1].toLowerCase()}/${m[2]}` : undefined;
}

/**
 * Tags du changeset d'une gare (rapport tags § 6 : un changeset par gare). `imagery_used` est
 * la valeur de la photo aérienne du pays de la gare ; `locale` est la langue de l'interface
 * (langue active par défaut : le commentaire proposé est rédigé dans cette langue).
 */
export function changesetTags(o: {
	comment: string;
	version: string;
	survey: boolean;
	imagery: boolean;
	locale?: string;
	country?: CountryCode;
}): Tags {
	const t: Tags = {
		created_by: `stationcomplete ${o.version}`,
		comment: o.comment.trim().slice(0, 255),
		hashtags: '#stationcomplete',
		locale: o.locale ?? locale()
	};
	if (o.survey) t.source = 'survey';
	if (o.imagery) t.imagery_used = imageryOf(o.country ?? DEFAULT_COUNTRY).imageryUsed;
	return t;
}
