// Quai logique (lot « quai en plusieurs parties », 11 novembre 2026).
// Dans OSM, un même quai physique est souvent découpé en plusieurs polygones `railway=platform` :
// la partie à l'air libre et les parties couvertes (dalle, passage sous une place : layer<0,
// tunnel, location=underground, covered=yes), comme les voies coupées aux tunnels. C'est la
// pratique OSM : l'appli ne fusionne jamais ces objets, elle les regroupe pour les compter et
// les montrer comme UN quai. Code pur (coordonnées locales en mètres), sans dépendance à
// l'interface ; seuils dans THRESHOLDS (quests.ts), passés en paramètre.

import { cross, dot, lineAngleDeg, principalAxis, segmentDistance, sub, type Pt } from './geo.ts';
import { isUnderground, splitValues, type Tags } from './osm.ts';

/** Seuils du regroupement (THRESHOLDS de quests.ts). */
export interface GroupThresholds {
	/** Bords des deux parties à moins de cette distance (m), à défaut d'un nœud partagé. */
	groupTouchM: number;
	/** Angle maximal entre les axes principaux des deux parties (degrés). */
	groupMaxAngleDeg: number;
	/** Décalage latéral maximal entre les axes (m) : les parties sont dans le prolongement. */
	groupMaxLateralM: number;
	/** Recouvrement maximal le long de l'axe (m), et en part de la plus courte des deux. */
	groupMaxOverlapM: number;
	groupMaxOverlapRatio: number;
	/** Angle maximal entre deux tronçons de voie mis bout à bout (degrés). */
	railJoinAngleDeg: number;
}

type Axis = { center: Pt; u: Pt; min: number; max: number; length: number; width: number };

/** Une partie candidate : un way ou un multipolygone `railway=platform`. */
export interface PartInput {
	nodes: number[];
	contour: Pt[][];
	tags: Tags;
	axis: Axis;
	/** Voies (ways) qui longent cette partie seule, et de quel côté de son axe. */
	tracks: { way: number; side: 'left' | 'right' }[];
}

export interface RailInput {
	id: number;
	nodes: number[];
	pts: Pt[];
	trackRef?: string;
}

export interface PlatformGroup {
	/** Indices des parties (dans la liste d'entrée), la partie principale d'abord. */
	members: number[];
	/** Partie principale : la plus longue à l'air libre, sinon la plus longue. */
	principal: number;
	/** Parties couvertes (souterraines ou covered=yes). */
	covered: number[];
	/** Axe et emprise du quai entier (toutes les parties). */
	axis: Axis;
	/** Numéros communs du quai (ceux de la partie principale si les parties divergent). */
	ref?: string;
	localRef?: string;
	/** Valeurs différentes d'une partie à l'autre (« 3 » et « 3;4 ») : quai incohérent. */
	mixed: { ref?: string[]; local_ref?: string[] };
	/** Parties sans numéro alors qu'une autre partie en porte un. */
	missingRef: number;
}

/** Partie couverte : souterraine (pointillés estompés) ou simplement couverte (covered=yes). */
export const isCoveredPart = (t: Tags = {}) => isUnderground(t) || t.covered === 'yes';

/** Valeur multiple normalisée (« 4;3 » = « 3; 4 »). */
const norm = (v?: string) => [...splitValues(v)].sort().join(';');

/** Union-find minimal. */
function unionFind(n: number) {
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	return { find, union: (a: number, b: number) => void (parent[find(a)] = find(b)) };
}

/**
 * Tronçons de voie mis bout à bout (voie coupée à l'entrée d'un tunnel, sous une dalle) :
 * même `railway:track_ref`, ou numéro absent d'un côté au moins mais un seul raccord possible
 * (exactement deux voies au nœud) ; toujours dans le prolongement l'un de l'autre. Deux numéros
 * différents ne sont jamais réunis. Renvoie, pour chaque way, l'identifiant de sa voie continue.
 */
export function railChains(rails: RailInput[], th: GroupThresholds): Map<number, number> {
	const uf = unionFind(rails.length);
	const railsAt = new Map<number, number[]>();
	rails.forEach((r, i) => {
		for (const n of new Set(r.nodes)) railsAt.set(n, [...(railsAt.get(n) ?? []), i]);
	});
	/** Direction qui part du nœud d'extrémité vers l'intérieur du tronçon. */
	const outDir = (r: RailInput, atStart: boolean): Pt | undefined => {
		if (r.pts.length < 2) return undefined;
		return atStart ? sub(r.pts[1], r.pts[0]) : sub(r.pts.at(-2)!, r.pts.at(-1)!);
	};
	rails.forEach((a, i) => {
		for (const atStart of [true, false]) {
			const node = atStart ? a.nodes[0] : a.nodes.at(-1)!;
			const here = railsAt.get(node) ?? [];
			for (const j of here) {
				if (j <= i) continue;
				const b = rails[j];
				const bStart = b.nodes[0] === node;
				if (!bStart && b.nodes.at(-1) !== node) continue; // passe au milieu : aiguillage
				const ra = a.trackRef?.trim(),
					rb = b.trackRef?.trim();
				if (ra && rb && norm(ra) !== norm(rb)) continue;
				if ((!ra || !rb) && here.length !== 2) continue;
				const da = outDir(a, atStart),
					db = outDir(b, bStart);
				// Prolongement : les deux tronçons partent du nœud dans des sens opposés, alignés.
				if (!da || !db || dot(da, db) >= 0 || lineAngleDeg(da, db) > th.railJoinAngleDeg) continue;
				uf.union(i, j);
			}
		}
	});
	return new Map(rails.map((r, i) => [r.id, rails[uf.find(i)].id]));
}

/** Distance minimale entre les contours de deux parties (0 s'ils se croisent). */
function contourDistance(a: Pt[][], b: Pt[][], limit: number) {
	let m = Infinity;
	for (const ra of a)
		for (const rb of b)
			for (let i = 0; i + 1 < ra.length; i++)
				for (let j = 0; j + 1 < rb.length; j++) {
					m = Math.min(m, segmentDistance(ra[i], ra[i + 1], rb[j], rb[j + 1]));
					if (m <= limit / 4) return m;
				}
	return m;
}

/** Étendue d'une partie le long d'un axe (origine `c`, direction `u`). */
function extent(contour: Pt[][], c: Pt, u: Pt) {
	let lo = Infinity,
		hi = -Infinity;
	for (const p of contour.flat()) {
		const s = dot(sub(p, c), u);
		lo = Math.min(lo, s);
		hi = Math.max(hi, s);
	}
	return [lo, hi] as const;
}

/**
 * Deux parties forment-elles le même quai ? Toutes les conditions :
 * 1. elles se touchent : nœud partagé, ou bords à moins de `groupTouchM` ;
 * 2. elles sont dans le prolongement l'une de l'autre : axes à moins de `groupMaxAngleDeg`,
 *    décalage latéral au raccord d'au plus `groupMaxLateralM`, recouvrement le long de l'axe limité (des
 *    quais parallèles côte à côte se recouvrent sur toute leur longueur) ;
 * 3. elles longent les mêmes voies (voies continues, voir railChains), du même côté : au moins
 *    une voie commune, aucune voie commune de côtés opposés (quais de part et d'autre d'une
 *    voie) ; ou aucune voie ni d'un côté ni de l'autre ;
 * 4. elles ne portent pas deux lettres ou noms différents (`local_ref`) : deux quais nommés.
 */
export function sameLogicalPlatform(
	a: PartInput,
	b: PartInput,
	chainOf: Map<number, number>,
	th: GroupThresholds
): boolean {
	const la = norm(a.tags.local_ref),
		lb = norm(b.tags.local_ref);
	if (la && lb && la !== lb) return false;
	if (lineAngleDeg(a.axis.u, b.axis.u) > th.groupMaxAngleDeg) return false;
	// Axe de référence : celui de la plus longue des deux parties.
	const [L, S] = a.axis.length >= b.axis.length ? [a, b] : [b, a];
	const u = L.axis.u;
	const nodesA = new Set(a.nodes);
	const touch = () =>
		b.nodes.some((n) => nodesA.has(n)) ||
		contourDistance(a.contour, b.contour, th.groupTouchM) <= th.groupTouchM;
	// Même nom (« Voie 27 ») et contact : c'est le même quai, même si les parties se chevauchent
	// ou sont décalées (données découpées à la main, Paris-Saint-Lazare). Seule réserve : ne
	// jamais réunir deux quais de part et d'autre d'une même voie.
	const na = norm(a.tags.name),
		nb = norm(b.tags.name);
	if (na && na === nb && touch()) return !oppositeSides(a, b, u, chainOf);
	// Décalage latéral mesuré au raccord (bouts d'axe en regard), pas aux centres : un quai en
	// légère courbe, coupé en deux, reste dans le prolongement.
	const end = (p: PartInput, toward: Pt) => {
		const s = dot(sub(toward, p.axis.center), p.axis.u) >= 0 ? p.axis.max : p.axis.min;
		return { x: p.axis.center.x + p.axis.u.x * s, y: p.axis.center.y + p.axis.u.y * s };
	};
	const joint = sub(end(S, L.axis.center), end(L, S.axis.center));
	if (Math.abs(cross(u, joint)) > th.groupMaxLateralM) return false;
	const [l0, l1] = extent(L.contour, L.axis.center, u);
	const [s0, s1] = extent(S.contour, L.axis.center, u);
	const overlap = Math.min(l1, s1) - Math.max(l0, s0);
	const shorter = Math.min(l1 - l0, s1 - s0);
	if (overlap > Math.min(th.groupMaxOverlapM, th.groupMaxOverlapRatio * shorter)) return false;
	// Contact : nœud partagé, sinon bords proches (l'écart le long de l'axe le borne déjà).
	if (overlap < -th.groupTouchM) return false;
	if (!touch()) return false;
	// Mêmes voies, du même côté (côtés ramenés à l'axe de référence).
	const sa = trackSides(a, u, chainOf),
		sb = trackSides(b, u, chainOf);
	if (!sa.size && !sb.size) return true;
	let common = 0;
	for (const [c, s] of sa) {
		const o = sb.get(c);
		if (!o) continue;
		if ([...s].some((x) => !o.has(x)) || [...o].some((x) => !s.has(x))) return false;
		common++;
	}
	return common > 0;
}

/** Voies longées par une partie, avec leur côté ramené à l'axe de référence `u`. */
function trackSides(p: PartInput, u: Pt, chainOf: Map<number, number>) {
	const flip = dot(p.axis.u, u) < 0;
	const m = new Map<number, Set<'left' | 'right'>>();
	for (const t of p.tracks) {
		const c = chainOf.get(t.way) ?? t.way;
		const s = flip ? (t.side === 'left' ? 'right' : 'left') : t.side;
		m.set(c, new Set([...(m.get(c) ?? []), s]));
	}
	return m;
}

/** Une même voie longe-t-elle les deux parties de côtés opposés (quais de part et d'autre) ? */
function oppositeSides(a: PartInput, b: PartInput, u: Pt, chainOf: Map<number, number>) {
	const sa = trackSides(a, u, chainOf),
		sb = trackSides(b, u, chainOf);
	for (const [c, s] of sa) {
		const o = sb.get(c);
		if (o && [...s].some((x) => !o.has(x)) && [...o].some((x) => !s.has(x))) return true;
	}
	return false;
}

/**
 * Regroupe les parties d'un même quai physique. Chaque partie appartient à un groupe (un quai
 * d'un seul morceau forme un groupe à lui seul). L'ordre des groupes suit celui de leur
 * première partie dans la liste d'entrée.
 */
export function groupPlatforms(
	parts: PartInput[],
	rails: RailInput[],
	th: GroupThresholds
): PlatformGroup[] {
	const chainOf = railChains(rails, th);
	const uf = unionFind(parts.length);
	for (let i = 0; i < parts.length; i++)
		for (let j = i + 1; j < parts.length; j++) {
			const a = parts[i],
				b = parts[j];
			// Préfiltre : centres trop éloignés pour que les parties se touchent.
			const reach =
				(a.axis.length + b.axis.length) / 2 + (a.axis.width + b.axis.width) / 2 + th.groupTouchM;
			const d = Math.hypot(a.axis.center.x - b.axis.center.x, a.axis.center.y - b.axis.center.y);
			if (d > reach) continue;
			if (uf.find(i) !== uf.find(j) && sameLogicalPlatform(a, b, chainOf, th)) uf.union(i, j);
		}
	const byRoot = new Map<number, number[]>();
	parts.forEach((_, i) => byRoot.set(uf.find(i), [...(byRoot.get(uf.find(i)) ?? []), i]));
	const groups = [...byRoot.values()].sort((x, y) => x[0] - y[0]);
	return groups.map((members) => describe(parts, members));
}

function describe(parts: PartInput[], members: number[]): PlatformGroup {
	const covered = members.filter((i) => isCoveredPart(parts[i].tags));
	const open = members.filter((i) => !covered.includes(i));
	const longest = (list: number[]) =>
		list.reduce((m, i) => (parts[i].axis.length > parts[m].axis.length ? i : m), list[0]);
	const principal = longest(open.length ? open : members);
	const ordered = [principal, ...members.filter((i) => i !== principal)];
	const axis =
		members.length === 1
			? parts[principal].axis
			: principalAxis(members.flatMap((i) => parts[i].contour.flat()));
	const combine = (key: 'ref' | 'local_ref') => {
		const values = ordered.map((i) => parts[i].tags[key]?.trim()).filter((v): v is string => !!v);
		const distinct = [...new Map(values.map((v) => [norm(v), v])).values()];
		return { value: parts[principal].tags[key]?.trim() || values[0], distinct };
	};
	const ref = combine('ref'),
		lr = combine('local_ref');
	const mixed: PlatformGroup['mixed'] = {};
	if (ref.distinct.length > 1) mixed.ref = ref.distinct;
	if (lr.distinct.length > 1) mixed.local_ref = lr.distinct;
	return {
		members: ordered,
		principal,
		covered,
		axis,
		...(ref.value ? { ref: ref.value } : {}),
		...(lr.value ? { localRef: lr.value } : {}),
		mixed,
		missingRef: ref.value ? members.filter((i) => !parts[i].tags.ref?.trim()).length : 0
	};
}
