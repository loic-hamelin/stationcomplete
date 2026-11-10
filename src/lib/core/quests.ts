// Moteur de quêtes Q0–Q7 (architecture § 4.3, spécification UX § 4).
// Entrée : la réponse de l'API OSM sur l'emprise d'une gare. Sortie : quais, voies adjacentes,
// pancartes, quêtes et jauges de complétude. Code pur, sans dépendance à l'interface.

import {
	LocalProjection,
	dot,
	lineAngleDeg,
	principalAxis,
	segmentToPolyline,
	sub,
	cross,
	distToSegment,
	type Pt
} from './geo.ts';
import {
	OsmData,
	inBBox,
	isClosed,
	isPlatform,
	isRail,
	splitValues,
	type BBox,
	type OsmElement,
	type OsmNode,
	type OsmWay,
	type Tags
} from './osm.ts';
import { DEFAULT_COUNTRY, countryConfig, type CountryCode } from './countries.ts';

// Seuils (heuristiques à régler sur les gares de référence).
export const THRESHOLDS = {
	maxAngleDeg: 20,
	polygonEdgeDistM: 6,
	lineAxisDistM: 12,
	minOverlapM: 20,
	minOverlapRatio: 0.5,
	stopSignMarginM: 50,
	checkDateMaxYears: 2,
	noteOverhangM: 300
};

export type QuestId = 'Q0' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7';
export type ElementRef = { type: 'node' | 'way' | 'relation'; id: number };

export interface Quest {
	id: QuestId;
	/** Objet principal concerné (absent pour Q0). */
	target?: ElementRef;
	/** Quai de rattachement, si pertinent. */
	platform?: ElementRef;
	/** La quête exige d'être sur place (numéros et pancartes lus sur le terrain). */
	onSite: boolean;
	/** Proposer une Note OSM plutôt qu'un tag (voie trop longue pour être numérotée d'un bloc). */
	asNote?: boolean;
	details?: Record<string, string | number | string[]>;
}

export interface TrackSide {
	way: number;
	side: 'left' | 'right';
	overlapM: number;
	trackRef?: string;
}

export interface PlatformInfo {
	ref: ElementRef;
	tags: Tags;
	lengthM: number;
	axis: { center: Pt; u: Pt; min: number; max: number };
	tracks: TrackSide[];
	stopSigns: number[];
}

/**
 * Voies qui longent un quai (même règle partout : quêtes, carte, avertissement de E11/E12) :
 * segments à moins de 20° de l'axe du quai, à moins de 6 m de son contour (12 m de l'axe pour
 * un quai tracé en ligne), recouvrant au moins min(20 m, moitié du quai) le long de son axe.
 * Contour et voies en coordonnées locales (mètres).
 */
export function platformTracks(
	contour: Pt[][],
	polygon: boolean,
	rails: { id: number; pts: Pt[]; trackRef?: string }[]
) {
	const pts = contour.flat();
	const axis = principalAxis(pts);
	const maxDist = polygon ? THRESHOLDS.polygonEdgeDistM : THRESHOLDS.lineAxisDistM;
	const tracks: TrackSide[] = [];
	for (const w of rails) {
		const line = w.pts;
		let overlap = 0;
		let sideSum = 0;
		for (let i = 0; i + 1 < line.length; i++) {
			const a = line[i],
				b = line[i + 1];
			if (lineAngleDeg(sub(b, a), axis.u) > THRESHOLDS.maxAngleDeg) continue;
			const d = Math.min(...contour.map((ring) => segmentToPolyline(a, b, ring)));
			if (d > maxDist) continue;
			const sa = dot(sub(a, axis.center), axis.u);
			const sb = dot(sub(b, axis.center), axis.u);
			const lo = Math.max(Math.min(sa, sb), axis.min);
			const hi = Math.min(Math.max(sa, sb), axis.max);
			if (hi <= lo) continue;
			overlap += hi - lo;
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			sideSum += Math.sign(cross(axis.u, sub(mid, axis.center))) * (hi - lo);
		}
		const needed = Math.min(THRESHOLDS.minOverlapM, THRESHOLDS.minOverlapRatio * axis.length);
		if (overlap >= needed && overlap > 0)
			tracks.push({
				way: w.id,
				side: sideSum >= 0 ? 'left' : 'right',
				overlapM: Math.round(overlap),
				trackRef: w.trackRef
			});
	}
	return { axis, tracks };
}

/**
 * Distance (m) entre une voie et le contour d'un quai, sur la partie de la voie qui fait face
 * au quai (projection sur son axe) ; sur toute la voie si aucune partie ne lui fait face.
 */
export function trackGapM(contour: Pt[][], line: Pt[]) {
	const axis = principalAxis(contour.flat());
	let facing = Infinity,
		any = Infinity;
	for (let i = 0; i + 1 < line.length; i++) {
		const a = line[i],
			b = line[i + 1];
		const d = Math.min(...contour.map((ring) => segmentToPolyline(a, b, ring)));
		any = Math.min(any, d);
		const sa = dot(sub(a, axis.center), axis.u),
			sb = dot(sub(b, axis.center), axis.u);
		if (Math.max(sa, sb) >= axis.min && Math.min(sa, sb) <= axis.max) facing = Math.min(facing, d);
	}
	return Number.isFinite(facing) ? facing : any;
}

export interface StationAnalysis {
	/** Pays de la gare : schéma des pancartes et règles de quêtes appliqués. */
	country: CountryCode;
	platforms: PlatformInfo[];
	/** Voies adjacentes à au moins un quai. */
	tracks: { way: number; trackRef?: string }[];
	/**
	 * Voies ferrées de la gare (emprise + 50 m) qui ne longent aucun quai (lot 7d) : dessinées
	 * sur la carte, plus discrètes, sans quête ni compteur.
	 */
	otherTracks: number[];
	stopSigns: OsmNode[];
	quests: Quest[];
	completeness: {
		platforms: { done: number; total: number };
		tracks: { done: number; total: number };
		stopSigns: { done: number; total: number };
	};
}

const PRIORITY: QuestId[] = ['Q7', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
const ON_SITE: Record<QuestId, boolean> = {
	Q0: false, // dessiner un quai : possible à distance (E11)
	Q1: true,
	Q2: true,
	Q3: true,
	Q4: true,
	Q5: true,
	Q6: false, // vérifier : possible à distance
	Q7: true
};

export function analyzeStation(
	elements: OsmElement[],
	bbox: BBox,
	now: Date = new Date(),
	country: CountryCode = DEFAULT_COUNTRY
): StationAnalysis {
	const config = countryConfig(country);
	// Pays sans schéma de pancartes établi : aucune pancarte reconnue, pas de quêtes Q4 et Q5.
	const signs = config.stopSigns;
	const isStopSign = (t?: Tags) => !!signs?.isStopSign(t);
	const isLegacyStopSign = (t?: Tags) => !!signs?.isLegacy(t);
	const data = new OsmData(elements);
	const proj = new LocalProjection((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2);
	const P = (n: OsmNode) => proj.project(n.lon, n.lat);
	const nodePts = (w: OsmWay) =>
		w.nodes.map((id) => data.nodes.get(id)).filter((n): n is OsmNode => !!n);
	const wayInBBox = (w: OsmWay) => nodePts(w).some((n) => inBBox(bbox, n.lon, n.lat));

	// ---- Quais : ways et multipolygones ----
	type RawPlatform = { ref: ElementRef; tags: Tags; contour: Pt[][]; polygon: boolean };
	const raw: RawPlatform[] = [];
	for (const w of data.ways.values()) {
		if (!isPlatform(w.tags) || !wayInBBox(w)) continue;
		raw.push({
			ref: { type: 'way', id: w.id },
			tags: w.tags ?? {},
			contour: [nodePts(w).map(P)],
			polygon: isClosed(w)
		});
	}
	for (const r of data.relations.values()) {
		if (!isPlatform(r.tags) || r.tags?.type !== 'multipolygon') continue;
		const rings = r.members
			.filter((m) => m.type === 'way' && m.role !== 'inner')
			.map((m) => data.ways.get(m.ref))
			.filter((w): w is OsmWay => !!w)
			.map((w) => nodePts(w).map(P));
		if (!rings.length || !rings.flat().length) continue;
		raw.push({
			ref: { type: 'relation', id: r.id },
			tags: r.tags ?? {},
			contour: rings,
			polygon: true
		});
	}

	// ---- Voies ----
	const rails = [...data.ways.values()].filter((w) => isRail(w.tags) && wayInBBox(w));
	const railPts = new Map(rails.map((w) => [w.id, nodePts(w).map(P)]));

	// ---- Pancartes d'arrêt dans l'emprise ----
	// Emprise élargie de 50 m : une pancarte se trouve souvent un peu avant le bout du quai.
	const m = THRESHOLDS.stopSignMarginM;
	const dLat = m / 111_320,
		dLon = m / (111_320 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180));
	const wide: BBox = [bbox[0] - dLon, bbox[1] - dLat, bbox[2] + dLon, bbox[3] + dLat];
	const stopSigns = [...data.nodes.values()].filter(
		(n) => isStopSign(n.tags) && inBBox(wide, n.lon, n.lat)
	);
	const stopSignWays = new Map(stopSigns.map((n) => [n.id, data.waysOfNode.get(n.id) ?? []]));

	// ---- Adjacence quai ↔ voie ----
	const railList = rails.map((w) => ({
		id: w.id,
		pts: railPts.get(w.id)!,
		trackRef: w.tags?.['railway:track_ref']
	}));
	const platforms: PlatformInfo[] = raw.map((p) => {
		const { axis, tracks } = platformTracks(p.contour, p.polygon, railList);
		// Pancartes sur une voie adjacente, dans l'intervalle du quai élargi de 50 m.
		const adjacent = new Set(tracks.map((t) => t.way));
		const signs = stopSigns
			.filter((n) => (stopSignWays.get(n.id) ?? []).some((w) => adjacent.has(w)))
			.filter((n) => {
				const s = dot(sub(P(n), axis.center), axis.u);
				return (
					s >= axis.min - THRESHOLDS.stopSignMarginM && s <= axis.max + THRESHOLDS.stopSignMarginM
				);
			})
			.map((n) => n.id);
		return {
			ref: p.ref,
			tags: p.tags,
			lengthM: Math.round(axis.length),
			axis: { center: axis.center, u: axis.u, min: axis.min, max: axis.max },
			tracks,
			stopSigns: signs
		};
	});

	const adjacentWays = new Map<number, string | undefined>();
	for (const p of platforms) for (const t of p.tracks) adjacentWays.set(t.way, t.trackRef);

	// ---- Détection ----
	const quests: Quest[] = [];
	const push = (q: Omit<Quest, 'onSite'>) => quests.push({ ...q, onSite: ON_SITE[q.id] });

	if (!platforms.length) push({ id: 'Q0' });

	for (const p of platforms) {
		if (!p.tags.ref)
			push({ id: 'Q1', target: p.ref, details: { local_ref: p.tags.local_ref ?? '' } });
		else {
			const known = p.tracks.filter((t) => t.trackRef).map((t) => t.trackRef!);
			const refs = splitValues(p.tags.ref);
			const trackRefs = new Set(known.flatMap((r) => [...splitValues(r)]));
			if (known.length === p.tracks.length && p.tracks.length && !sameSet(refs, trackRefs))
				push({
					id: 'Q3',
					target: p.ref,
					details: { ref: p.tags.ref, voies: [...trackRefs].sort() }
				});
		}
		// Q4 : un côté de quai bordé d'une voie, sans aucune pancarte sur ce côté.
		if (signs)
			for (const side of ['left', 'right'] as const) {
				const ways = new Set(p.tracks.filter((t) => t.side === side).map((t) => t.way));
				if (!ways.size) continue;
				const hasSign = p.stopSigns.some((id) =>
					(stopSignWays.get(id) ?? []).some((w) => ways.has(w))
				);
				if (!hasSign)
					push({
						id: 'Q4',
						platform: p.ref,
						target: { type: 'way', id: [...ways][0] },
						details: { side }
					});
			}
	}

	for (const [wayId, trackRef] of adjacentWays) {
		if (trackRef) continue;
		const w = data.ways.get(wayId)!;
		push({
			id: 'Q2',
			target: { type: 'way', id: wayId },
			platform: platforms.find((p) => p.tracks.some((t) => t.way === wayId))?.ref,
			asNote: overhangsWithSwitch(w)
		});
	}

	for (const n of stopSigns) {
		const t = n.tags ?? {};
		if (isLegacyStopSign(t) || !t['railway:signal:direction'])
			push({
				id: 'Q5',
				target: { type: 'node', id: n.id },
				details: {
					motif: isLegacyStopSign(t) ? 'ancien format' : 'sens manquant',
					valeur: t['railway:signal:stop'] ?? ''
				}
			});
	}

	// Q6 : objets renseignés jamais vérifiés, ou vérifiés il y a plus de 2 ans.
	const limit = new Date(now);
	limit.setFullYear(limit.getFullYear() - THRESHOLDS.checkDateMaxYears);
	const stale = (t: Tags = {}) => !t.check_date || new Date(t.check_date) < limit;
	for (const p of platforms) if (p.tags.ref && stale(p.tags)) push({ id: 'Q6', target: p.ref });
	for (const [wayId, ref] of adjacentWays)
		if (ref && stale(data.ways.get(wayId)!.tags))
			push({ id: 'Q6', target: { type: 'way', id: wayId } });
	for (const n of stopSigns)
		if (!isLegacyStopSign(n.tags) && stale(n.tags))
			push({ id: 'Q6', target: { type: 'node', id: n.id } });

	// Q7 : même numéro sur deux voies à quai distinctes (non reliées), ou « Voie 1 » dans name/ref.
	const byRef = new Map<string, number[]>();
	for (const [wayId, ref] of adjacentWays)
		if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), wayId]);
	for (const [ref, ways] of byRef) {
		const groups = connectedGroups(ways, data);
		if (groups.length > 1)
			push({
				id: 'Q7',
				target: { type: 'way', id: groups[1][0] },
				details: { motif: 'numéro en double', ref }
			});
	}
	for (const wayId of adjacentWays.keys()) {
		const t = data.ways.get(wayId)!.tags ?? {};
		const bad = [t.name, t.ref].find((v) => v && config.quests.misplacedTrackRef.test(v));
		if (bad)
			push({
				id: 'Q7',
				target: { type: 'way', id: wayId },
				details: { motif: 'numéro mal placé', valeur: bad }
			});
	}

	quests.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));

	// ---- Jauges ----
	const sides = (signs ? platforms : []).flatMap((p) =>
		(['left', 'right'] as const)
			.filter((s) => p.tracks.some((t) => t.side === s))
			.map((s) => ({ p, s }))
	);
	const sidesDone = sides.filter(({ p, s }) => {
		const ways = new Set(p.tracks.filter((t) => t.side === s).map((t) => t.way));
		return p.stopSigns.some((id) => (stopSignWays.get(id) ?? []).some((w) => ways.has(w)));
	}).length;

	return {
		country: config.code,
		platforms,
		tracks: [...adjacentWays].map(([way, trackRef]) => ({ way, trackRef })),
		otherTracks: [...data.ways.values()]
			.filter(
				(w) =>
					isRail(w.tags) &&
					!adjacentWays.has(w.id) &&
					nodePts(w).some((n) => inBBox(wide, n.lon, n.lat))
			)
			.map((w) => w.id),
		stopSigns,
		quests,
		completeness: {
			platforms: { done: platforms.filter((p) => p.tags.ref).length, total: platforms.length },
			tracks: { done: [...adjacentWays.values()].filter(Boolean).length, total: adjacentWays.size },
			stopSigns: { done: sidesDone, total: sides.length }
		}
	};

	// Voie qui dépasse un quai de plus de 300 m et traverse un aiguillage : à découper, donc Note OSM.
	function overhangsWithSwitch(w: OsmWay) {
		const pts = railPts.get(w.id) ?? [];
		const hasSwitch = w.nodes.some((id) => data.nodes.get(id)?.tags?.railway === 'switch');
		if (!hasSwitch) return false;
		const ps = platforms.filter((p) => p.tracks.some((t) => t.way === w.id));
		return ps.some((p) => {
			const s = pts.map((q) => dot(sub(q, p.axis.center), p.axis.u));
			return (
				Math.min(...s) < p.axis.min - THRESHOLDS.noteOverhangM ||
				Math.max(...s) > p.axis.max + THRESHOLDS.noteOverhangM
			);
		});
	}
}

function sameSet(a: Set<string>, b: Set<string>) {
	return a.size === b.size && [...a].every((x) => b.has(x));
}

/** Regroupe des ways reliés entre eux (nœud commun). */
function connectedGroups(ways: number[], data: OsmData): number[][] {
	const parent = new Map(ways.map((w) => [w, w]));
	const find = (w: number): number => (parent.get(w) === w ? w : find(parent.get(w)!));
	const set = new Set(ways);
	for (const w of ways)
		for (const n of data.ways.get(w)!.nodes)
			for (const o of data.waysOfNode.get(n) ?? []) if (set.has(o)) parent.set(find(o), find(w));
	const groups = new Map<number, number[]>();
	for (const w of ways) groups.set(find(w), [...(groups.get(find(w)) ?? []), w]);
	return [...groups.values()];
}

/** Distance (m) d'un point à une voie — utilitaire pour l'accrochage (lots suivants). */
export function distanceToWay(p: Pt, line: Pt[]) {
	let m = Infinity;
	for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, distToSegment(p, line[i], line[i + 1]));
	return m;
}
