// Modèle de données OSM minimal, construit à partir de la réponse JSON de l'API OSM
// (GET /api/0.6/map.json). Code pur : aucune dépendance au navigateur ni à l'interface.

export type Tags = Record<string, string>;

export interface OsmNode {
	type: 'node';
	id: number;
	lat: number;
	lon: number;
	version?: number;
	tags?: Tags;
}
export interface OsmWay {
	type: 'way';
	id: number;
	nodes: number[];
	version?: number;
	tags?: Tags;
}
export interface OsmRelation {
	type: 'relation';
	id: number;
	members: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
	version?: number;
	tags?: Tags;
}
export type OsmElement = OsmNode | OsmWay | OsmRelation;

/** Boîte [ouest, sud, est, nord] en degrés. */
export type BBox = [number, number, number, number];

export class OsmData {
	readonly nodes = new Map<number, OsmNode>();
	readonly ways = new Map<number, OsmWay>();
	readonly relations = new Map<number, OsmRelation>();
	/** Pour chaque nœud, les ways qui le contiennent. */
	readonly waysOfNode = new Map<number, number[]>();

	constructor(elements: OsmElement[]) {
		for (const e of elements) {
			if (e.type === 'node') this.nodes.set(e.id, e);
			else if (e.type === 'way') this.ways.set(e.id, e);
			else if (e.type === 'relation') this.relations.set(e.id, e);
		}
		for (const w of this.ways.values())
			for (const n of w.nodes) {
				const list = this.waysOfNode.get(n);
				if (list) list.push(w.id);
				else this.waysOfNode.set(n, [w.id]);
			}
	}

	/** Coordonnées [lon, lat] des nœuds d'un way (les nœuds absents sont ignorés). */
	coords(way: OsmWay): [number, number][] {
		const out: [number, number][] = [];
		for (const id of way.nodes) {
			const n = this.nodes.get(id);
			if (n) out.push([n.lon, n.lat]);
		}
		return out;
	}
}

export const inBBox = (b: BBox, lon: number, lat: number) =>
	lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

export const isClosed = (w: OsmWay) => w.nodes.length > 3 && w.nodes[0] === w.nodes.at(-1);

// ---------- Rôles ferroviaires (rapport tags § 3) ----------

/** Modes de transport autres que le train : leur présence écarte un `public_transport=platform`. */
const OTHER_MODES = [
	'bus',
	'trolleybus',
	'share_taxi',
	'tram',
	'light_rail',
	'subway',
	'monorail',
	'funicular',
	'ferry',
	'aerialway',
	'coach'
] as const;

/**
 * Quai de train : `railway=platform`, ou `public_transport=platform` avec `train=yes`, ou
 * `public_transport=platform` sans aucun autre mode précisé (issue #1 : `train=yes` manque
 * souvent, et le wiki ne le demande pas). Un quai de bus, de tram, de métro… est écarté.
 */
export const isPlatform = (t: Tags = {}) => {
	if (t.railway === 'platform') return true;
	if (t.public_transport !== 'platform' || t.train === 'no') return false;
	if (t.train === 'yes') return true;
	if (OTHER_MODES.some((m) => t[m] === 'yes')) return false;
	if (t.highway === 'bus_stop' || t.highway === 'platform') return false;
	if (t.railway === 'tram_stop' || t.amenity === 'bus_station') return false;
	return true;
};

export const isRail = (t: Tags = {}) => t.railway === 'rail';

// Pancartes d'arrêt : propres à chaque pays (schéma dans stopsigns/, choisi par countries.ts).

/** Premier nombre d'une valeur (« -1;0 » → -1), NaN sinon. */
const firstNumber = (v?: string) => parseFloat((v ?? '').split(';')[0].trim());

/**
 * Objet souterrain (lot 7d, légende : pointillés estompés) : tunnel (voies), couche négative,
 * `location=underground`, niveau négatif (premier niveau d'une liste), ou couvert sous le sol.
 */
export const isUnderground = (t: Tags = {}) =>
	t.tunnel === 'yes' ||
	t.tunnel === 'building_passage' ||
	firstNumber(t.layer) < 0 ||
	t.location === 'underground' ||
	firstNumber(t.level) < 0;
// (« covered=yes » + layer<0 est déjà couvert par layer<0 ; covered seul n'est pas souterrain.)

/** Découpe une valeur multiple OSM (« 1;2 ») en ensemble de valeurs nettoyées. */
export const splitValues = (v?: string) =>
	new Set(
		(v ?? '')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean)
	);
