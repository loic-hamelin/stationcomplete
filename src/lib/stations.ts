// Index des gares par pays (static/data/stations-<cc>.json) : chargement, recherche et
// « autour de moi ». Une gare appartient au pays de l'index d'où elle vient.

import { asset } from '$app/paths';
import { countryConfig, enabledCountries, type CountryCode } from './core/countries.js';
import type { BBox } from './core/osm.js';
import type { StationAnalysis } from './core/quests.js';
import { fmtDistance, fmtNumber, t } from './i18n/t.js';

export interface Station {
	/** Identifiant OSM (« n123 ») : unique dans le monde, il ne porte pas le pays. */
	id: string;
	name: string;
	norm: string;
	commune: string;
	/** Subdivision (département, canton…) : voir `subdivision` dans la configuration du pays. */
	admin: string;
	uic: string;
	lat: number;
	lon: number;
	halt: boolean;
	bbox: BBox;
	/** Pays de l'index d'où vient la gare. */
	country: CountryCode;
	/**
	 * Jauges calculées chaque semaine par la CI (11e colonne de l'index, facultative) : mêmes
	 * règles que l'appli, sur l'état d'OSM au jour de l'index, sans les saisies du téléphone.
	 * Absentes dans un index construit avant leur ajout.
	 */
	gauges?: Gauges;
}

/** Jauges d'une gare : quais numérotés, voies numérotées, côtés de quai avec pancarte. */
export type Gauges = StationAnalysis['completeness'];

/** Ligne compacte de l'index (tableaux) ; jauges : [quais faits, total, voies…, côtés…]. */
type Row = [
	string,
	string,
	string,
	string,
	string,
	string,
	number,
	number,
	'S' | 'H',
	BBox,
	number[]?
];

/** Jauges de la 11e colonne de l'index (undefined si absente ou mal formée). */
export function gaugesOfRow(g: unknown): Gauges | undefined {
	if (!Array.isArray(g) || g.length !== 6 || !g.every((x) => Number.isInteger(x) && x >= 0))
		return undefined;
	return {
		platforms: { done: g[0], total: g[1] },
		tracks: { done: g[2], total: g[3] },
		stopSigns: { done: g[4], total: g[5] }
	};
}

/**
 * Ce qui reste à faire d'après les jauges : objets non renseignés, plus 1 pour une gare sans
 * aucun quai dans OSM (quai à dessiner).
 */
export const todoCount = (g: Gauges) =>
	g.platforms.total -
	g.platforms.done +
	(g.tracks.total - g.tracks.done) +
	(g.stopSigns.total - g.stopSigns.done) +
	(g.platforms.total ? 0 : 1);

export interface StationIndex {
	version: string;
	stations: Station[];
}

const loading = new Map<CountryCode, Promise<StationIndex>>();

/** Index des gares d'un pays (chargé une fois, nouvel essai après une erreur). */
export function loadStations(code: CountryCode): Promise<StationIndex> {
	let p = loading.get(code);
	if (!p) {
		const country = countryConfig(code);
		// Fichier publié par la CI pour chaque pays activé (vérifié par countries.test.ts).
		p = fetch(asset(country.index.file as Parameters<typeof asset>[0]))
			.then((r) => {
				if (!r.ok) throw new Error(t('error.index', { status: r.status }));
				return r.json() as Promise<{ v: string; s: Row[] }>;
			})
			.then(({ v, s }) => ({
				version: v,
				stations: s.map(([id, name, norm, commune, admin, uic, lat, lon, type, bbox, g]) => ({
					id,
					name,
					norm,
					commune,
					admin,
					uic,
					lat,
					lon,
					halt: type === 'H',
					bbox,
					country: country.code,
					gauges: gaugesOfRow(g)
				}))
			}))
			.catch((e) => {
				loading.delete(code); // nouvel essai au prochain appel
				throw e;
			});
		loading.set(code, p);
	}
	return p;
}

/**
 * Gares de tous les pays activés (gares récentes, téléchargées, contributions) ; le pays
 * donné en premier. Une gare frontalière n'est que dans un index (découpage par pays en CI).
 */
export async function loadAllStations(first?: CountryCode): Promise<Station[]> {
	const lists = await Promise.all(countryOrder(first).map((c) => loadStations(c)));
	return lists.flatMap((l) => l.stations);
}

/**
 * Gare d'après son identifiant : dans l'index du pays donné d'abord, puis dans ceux des autres
 * pays activés (chargés seulement si besoin).
 */
export async function findStation(id: string, first?: CountryCode) {
	for (const code of countryOrder(first)) {
		const s = (await loadStations(code)).stations.find((x) => x.id === id);
		if (s) return s;
	}
	return undefined;
}

const countryOrder = (first?: CountryCode) =>
	enabledCountries()
		.map((c) => c.code)
		.sort((a, b) => Number(b === first) - Number(a === first));

export function normalize(s: string) {
	return s
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[''`’]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

// « St »/« Ste » valent « Saint »/« Sainte » (et l'inverse) ; dans un nom, on écrit toujours la
// forme longue, la requête est essayée sous ses deux formes.
const SAINTS: Record<string, string> = {
	st: 'saint',
	ste: 'sainte',
	sts: 'saints',
	stes: 'saintes'
};
const longSaints = (norm: string) =>
	norm
		.split(' ')
		.map((w) => SAINTS[w] ?? w)
		.join(' ');

/** Nom ou commune préparés pour la recherche (gardés en cache par gare). */
const prepared = new WeakMap<Station, { name: string; commune: string; compact: string }>();
function prep(s: Station) {
	let p = prepared.get(s);
	if (!p) {
		const name = longSaints(s.norm);
		p = { name, commune: longSaints(normalize(s.commune)), compact: name.replaceAll(' ', '') };
		prepared.set(s, p);
	}
	return p;
}

/**
 * Pertinence d'une gare pour une requête normalisée (plus petit = meilleur ; -1 : aucune).
 * 0 nom exact, 1 début du nom, 2 début d'un mot du nom, 3 début d'un mot de la commune,
 * 4 ailleurs dans le nom ou la commune, 5 début du code UIC.
 */
function relevance(s: Station, variants: string[]) {
	const p = prep(s);
	let best = -1;
	const keep = (score: number) => (best = best < 0 ? score : Math.min(best, score));
	for (const q of variants) {
		const compact = q.replaceAll(' ', '');
		if (p.name === q) keep(0);
		else if (p.name.startsWith(q) || p.compact.startsWith(compact)) keep(1);
		else if ((' ' + p.name).includes(' ' + q)) keep(2);
		else if ((' ' + p.commune).includes(' ' + q)) keep(3);
		else if (p.name.includes(q) || p.commune.includes(q) || p.compact.includes(compact)) keep(4);
	}
	if (best < 0 && s.uic && variants[0].length >= 2 && s.uic.startsWith(variants[0])) best = 5;
	return best;
}

/**
 * Recherche sur le nom, la commune et le code UIC, insensible aux accents, à la casse, aux
 * tirets et aux apostrophes ; « st » vaut « saint ». Tri par pertinence (début du nom, puis
 * début d'un mot, puis ailleurs), puis, à pertinence égale, par distance à `from` si elle est
 * connue (sinon nom le plus court d'abord).
 */
export function search(
	stations: Station[],
	query: string,
	limit = 30,
	from?: { lat: number; lon: number }
): Station[] {
	const q = normalize(query);
	if (q.length < 2) return [];
	const variants = [...new Set([q, longSaints(q)])];
	const scored: [number, number, Station][] = [];
	for (const s of stations) {
		const r = relevance(s, variants);
		if (r < 0) continue;
		const tie = from ? distanceM(from.lat, from.lon, s.lat, s.lon) : s.norm.length;
		scored.push([r, tie, s]);
	}
	return scored
		.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].norm.localeCompare(b[2].norm))
		.slice(0, limit)
		.map(([, , s]) => s);
}

/** Résultats groupés par pays, le pays courant d'abord (un seul groupe aujourd'hui). */
export function groupByCountry(results: Station[], first?: CountryCode) {
	const groups = new Map<CountryCode, Station[]>();
	for (const s of results) groups.set(s.country, [...(groups.get(s.country) ?? []), s]);
	return [...groups]
		.sort(([a], [b]) => Number(b === first) - Number(a === first))
		.map(([country, stations]) => ({ country, stations }));
}

/** Distance en mètres (formule de haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
	const R = 6_371_008.8,
		r = Math.PI / 180;
	const dLat = (lat2 - lat1) * r,
		dLon = (lon2 - lon1) * r;
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearby(stations: Station[], lat: number, lon: number, limit = 10) {
	return stations
		.map((s) => ({ s, d: distanceM(lat, lon, s.lat, s.lon) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, limit);
}

/** Distance d'une gare : « 120 m », « 1,2 km » (« 1.2 km » en anglais), selon la langue. */
export function formatDistance(m: number) {
	if (m < 1000) return fmtDistance(Math.round(m / 10) * 10);
	const digits = m < 10_000 ? 1 : 0;
	return `${fmtNumber(m / 1000, { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

/** L'utilisateur est « sur place » si sa position (précision ≤ 100 m) tombe dans l'emprise. */
export function isOnSite(s: Station, lat: number, lon: number, accuracyM: number) {
	if (accuracyM > 100) return false;
	const [w, so, e, n] = s.bbox;
	return lon >= w && lon <= e && lat >= so && lat <= n;
}
