// Équipements ponctuels (lot « Équipements », étape 2) : ascenseurs et distributeurs de billets.
// Code pur, chargeable par Node (imports en .ts, TypeScript effaçable). Tags et sources :
// docs/osm-tags-rapport.md § 10.2.
//
// - Ascenseur : highway=elevator (de facto), level = niveaux desservis (« -1;0 »), wheelchair.
//   Le wiki n'exige pas que le nœud soit relié aux chemins piétons : un nœud isolé est accepté
//   (il n'aide pas encore le calcul d'itinéraire ; le relier reste à faire dans iD ou JOSM).
// - Distributeur : amenity=vending_machine + vending=public_transport_tickets (approuvé),
//   operator facultatif, level si connu.
// - Points d'assistance / rendez-vous (« Accès Plus ») : aucun tag établi (rapport § 10.2),
//   donc pas proposés.

import { LocalProjection, cross, dot, pointInPolygon, principalAxis, sub, type Pt } from './geo.ts';
import type { OsmElement, OsmNode, OsmWay, Tags } from './osm.ts';

export const POINT_KINDS = ['elevator', 'ticket'] as const;
export type PointKind = (typeof POINT_KINDS)[number];

/** Type d'équipement ponctuel d'un objet OSM, s'il en est un. */
export function pointKindOf(t: Tags = {}): PointKind | undefined {
	if (t.highway === 'elevator') return 'elevator';
	if (
		t.amenity === 'vending_machine' &&
		(t.vending ?? '')
			.split(';')
			.map((v) => v.trim())
			.includes('public_transport_tickets')
	)
		return 'ticket';
	return undefined;
}

/** Tags qui font l'objet (jamais retirés par une correction d'attributs). */
export const BASE_TAGS: Record<PointKind, Tags> = {
	elevator: { highway: 'elevator' },
	ticket: { amenity: 'vending_machine', vending: 'public_transport_tickets' }
};

/** Saisie de la fiche d'un équipement ponctuel ; undefined = « Je ne sais pas » / vide. */
export interface PointInput {
	/** Niveaux (« 0 », « -1;0 »), tels que saisis. */
	level?: string;
	/** Ascenseur accessible en fauteuil roulant. */
	wheelchair?: 'yes' | 'no';
	/** Exploitant d'un distributeur (texte libre). */
	operator?: string;
}

/** Niveaux nettoyés (« -1 ; 0 », « -1, 0 » → « -1;0 ») ; undefined si vide. */
export function cleanLevel(v?: string): string | undefined {
	const parts = (v ?? '')
		.split(/[;,/]|\s+(?=-?\d)/)
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length ? [...new Set(parts)].join(';') : undefined;
}

/** Niveaux lisibles : nombres (éventuellement négatifs ou décimaux) séparés par « ; ». */
export const levelOk = (v?: string) => {
	const c = cleanLevel(v);
	return c === undefined || /^-?\d+(\.\d+)?(;-?\d+(\.\d+)?)*$/.test(c);
};

/** Tags d'un nouvel équipement ponctuel (sans check_date). */
export function newPointTags(kind: PointKind, input: PointInput): Tags {
	const t: Tags = { ...BASE_TAGS[kind] };
	const level = cleanLevel(input.level);
	if (level) t.level = level;
	if (kind === 'elevator' && input.wheelchair) t.wheelchair = input.wheelchair;
	const op = input.operator?.trim().slice(0, 80);
	if (kind === 'ticket' && op) t.operator = op;
	return t;
}

/**
 * Tags qui changent sur un équipement existant. Un champ vide ou « Je ne sais pas » ne retire
 * rien : on ne corrige que ce qu'on a vu.
 */
export function pointTagChanges(kind: PointKind, input: PointInput, current: Tags = {}) {
	const want = newPointTags(kind, input);
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(want))
		if (!(k in BASE_TAGS[kind]) && current[k] !== v) out[k] = v;
	return out;
}

/** Position d'un objet OSM (nœud, ou centre des nœuds d'un way). */
export function positionOf(
	e: OsmElement,
	nodeOf: (id: number) => OsmNode | undefined
): [number, number] | undefined {
	if (e.type === 'node') return [e.lon, e.lat];
	if (e.type !== 'way') return undefined;
	const pts = (e as OsmWay).nodes
		.slice(0, (e as OsmWay).nodes.length > 1 && e.nodes[0] === e.nodes.at(-1) ? -1 : undefined)
		.map(nodeOf)
		.filter((n): n is OsmNode => !!n);
	if (!pts.length) return undefined;
	return [
		pts.reduce((s, n) => s + n.lon, 0) / pts.length,
		pts.reduce((s, n) => s + n.lat, 0) / pts.length
	];
}

/** Distance (m) entre deux positions [lon, lat] proches. */
export function metres(a: [number, number], b: [number, number]) {
	const p = new LocalProjection(a[0], a[1]).project(b[0], b[1]);
	return Math.hypot(p.x, p.y);
}

/** Seuil des doublons : un équipement du même type à moins de 5 m est probablement le même. */
export const DUPLICATE_M = 5;

/** Équipements du même type à moins de `maxM` mètres, du plus proche au plus loin. */
export function nearbySame(
	kind: PointKind,
	at: [number, number],
	elements: OsmElement[],
	maxM = DUPLICATE_M
) {
	const nodes = new Map(
		elements.filter((e): e is OsmNode => e.type === 'node').map((n) => [n.id, n])
	);
	const out: { el: OsmElement; distM: number }[] = [];
	for (const e of elements) {
		if (e.type === 'relation' || pointKindOf(e.tags) !== kind) continue;
		const p = positionOf(e, (id) => nodes.get(id));
		if (!p) continue;
		const d = metres(at, p);
		if (d < maxM) out.push({ el: e, distM: d });
	}
	return out.sort((a, b) => a.distM - b.distM);
}

// ---------- Placement relatif au quai (équipement à l'intérieur ou sous terre) ----------

/** Position le long du quai : un bout, le milieu, ou une distance (m) depuis le premier bout. */
export type Along = 'start' | 'middle' | 'end' | number;
/** Côté du quai (gauche/droite de son axe, du premier bout vers le second), ou au milieu. */
export type Side = 'left' | 'right' | 'center';

/** Retrait depuis un bout quand on choisit « bout » (m), au plus 15 % de la longueur. */
const END_INSET_M = 8;
/** Retrait depuis le bord quand on choisit un côté (m), au plus le quart de la largeur. */
const EDGE_INSET_M = 1;

/**
 * Repère d'un quai pour y situer un équipement : axe principal (du premier bout au second),
 * longueur, caps des deux bouts (pour les nommer : « bout côté nord-est »), côté d'un point.
 * `rings` : contours [lon, lat] des parties du quai (ou la ligne d'un quai tracé en ligne).
 */
export function platformFrame(rings: [number, number][][]) {
	const all = rings.flat();
	const lon0 = all.reduce((s, p) => s + p[0], 0) / all.length;
	const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length;
	const proj = new LocalProjection(lon0, lat0);
	const local = rings.map((r) => r.map(([lon, lat]) => proj.project(lon, lat)));
	const axis = principalAxis(local.flat());
	const v: Pt = { x: -axis.u.y, y: axis.u.x }; // gauche de l'axe
	const bearing = (d: Pt) => ((Math.atan2(d.x, d.y) * 180) / Math.PI + 360) % 360;
	const closed = (r: Pt[]) =>
		r.length > 3 && r[0].x === r.at(-1)!.x && r[0].y === r.at(-1)!.y ? r : undefined;
	const polygons = local.map(closed).filter((r): r is Pt[] => !!r);

	/** Abscisse (m depuis le premier bout) d'un choix « le long du quai ». */
	const sOf = (along: Along) => {
		const inset = Math.min(END_INSET_M, 0.15 * axis.length);
		if (along === 'start') return inset;
		if (along === 'end') return axis.length - inset;
		if (along === 'middle') return axis.length / 2;
		return Math.min(Math.max(along, 0), axis.length);
	};

	/** Intervalle [tmin, tmax] du quai sur la perpendiculaire à l'axe, à l'abscisse s. */
	function crossSection(s: number): [number, number] | undefined {
		const o: Pt = {
			x: axis.center.x + axis.u.x * (axis.min + s),
			y: axis.center.y + axis.u.y * (axis.min + s)
		};
		const ts: number[] = [];
		for (const ring of polygons)
			for (let i = 0; i + 1 < ring.length; i++) {
				const a = ring[i],
					b = ring[i + 1];
				const d = sub(b, a);
				const den = cross(v, d);
				if (Math.abs(den) < 1e-12) continue;
				const ao = sub(a, o);
				const t = cross(ao, d) / den; // position sur la perpendiculaire
				const k = cross(ao, v) / den; // position sur le segment
				if (k >= 0 && k <= 1) ts.push(t);
			}
		ts.sort((x, y) => x - y);
		if (ts.length < 2) return undefined;
		// Intervalle qui contient l'axe (t = 0), sinon le plus proche.
		let best: [number, number] | undefined;
		let bestGap = Infinity;
		for (let i = 0; i + 1 < ts.length; i += 2) {
			const [lo, hi] = [ts[i], ts[i + 1]];
			const gap = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
			if (gap < bestGap) [best, bestGap] = [[lo, hi], gap];
		}
		return best;
	}

	return {
		lengthM: axis.length,
		/** Cap (degrés) vers le premier bout et vers le second, depuis le milieu du quai. */
		startBearing: bearing({ x: -axis.u.x, y: -axis.u.y }),
		endBearing: bearing(axis.u),
		/** Cap du côté gauche (perpendiculaire à l'axe), pour nommer un côté sans voie. */
		leftBearing: bearing(v),
		/** Côté d'un point (une voie le long du quai, par exemple). */
		sideOf(lon: number, lat: number): 'left' | 'right' {
			return dot(sub(proj.project(lon, lat), axis.center), v) >= 0 ? 'left' : 'right';
		},
		/** Abscisse (m depuis le premier bout) d'un point projeté sur l'axe. */
		alongOf(lon: number, lat: number) {
			return dot(sub(proj.project(lon, lat), axis.center), axis.u) - axis.min;
		},
		/**
		 * Point choisi : à l'intérieur du contour (à 1 m du bord pour un côté, au milieu de la
		 * largeur sinon). Quai tracé en ligne : sur la ligne (pas de largeur connue).
		 */
		place(along: Along, side: Side) {
			const s = sOf(along);
			const sec = crossSection(s);
			let t = 0;
			if (sec) {
				const [lo, hi] = sec;
				const inset = Math.min(EDGE_INSET_M, (hi - lo) / 4);
				t = side === 'left' ? hi - inset : side === 'right' ? lo + inset : (lo + hi) / 2;
			}
			const p: Pt = {
				x: axis.center.x + axis.u.x * (axis.min + s) + v.x * t,
				y: axis.center.y + axis.u.y * (axis.min + s) + v.y * t
			};
			const [lon, lat] = proj.unproject(p);
			return {
				lon,
				lat,
				alongM: s,
				inside: polygons.some((r) => pointInPolygon(p, r))
			};
		}
	};
}
