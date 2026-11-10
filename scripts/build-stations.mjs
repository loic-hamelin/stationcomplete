// Construit l'index des gares d'un pays (static/data/stations-<cc>.json) à partir d'un export
// GeoJSON (séquence) de l'extrait OSM filtré par osmium. Lancé chaque semaine par la CI, une
// fois par pays activé (workflow « Index des gares »).
//
// Usage : node scripts/build-stations.mjs rail-fr.geojsonseq [--country fr]
//           [--osm jauges-fr.opl] [--out …] [--communes …] [--stats …] [--offline]
// Fichiers par défaut, extrait Geofabrik, géocodage et pancartes : configuration du pays
// (src/lib/core/countries.ts, chargée directement par Node).
//
// Pour chaque gare : identifiant OSM, nom, nom normalisé, commune, subdivision (département,
// canton…), UIC, position, type (S = gare, H = halte) et emprise serrée (quais + marge) à
// demander à l'API OSM. Avec --osm (extrait OPL des quais, voies et signaux, coordonnées dans
// les ways : « osmium add-locations-to-ways »), une 11e colonne donne les jauges de la gare
// (quais numérotés, voies numérotées, côtés de quai avec pancarte : faits/total), calculées par
// le moteur de quêtes de l'appli lui-même (analyzeStation) sur la même emprise que l'appli.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { COUNTRIES, DEFAULT_COUNTRY, isCountryCode } from '../src/lib/core/countries.ts';
import { THRESHOLDS, analyzeStation } from '../src/lib/core/quests.ts';

function argValue(name) {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
}

// ---------- Géométrie simple (degrés ↔ mètres) ----------
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
const distM = (a, b) =>
	Math.hypot((a[0] - b[0]) * mPerDegLon((a[1] + b[1]) / 2), (a[1] - b[1]) * M_PER_DEG_LAT);

function coordsOf(geom) {
	switch (geom.type) {
		case 'Point':
			return [geom.coordinates];
		case 'LineString':
		case 'MultiPoint':
			return geom.coordinates;
		case 'Polygon':
		case 'MultiLineString':
			return geom.coordinates.flat();
		case 'MultiPolygon':
			return geom.coordinates.flat(2);
		default:
			return [];
	}
}
function bboxOf(points) {
	let w = Infinity,
		s = Infinity,
		e = -Infinity,
		n = -Infinity;
	for (const [x, y] of points) {
		if (x < w) w = x;
		if (x > e) e = x;
		if (y < s) s = y;
		if (y > n) n = y;
	}
	return [w, s, e, n];
}
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
function expand(b, m) {
	const lat = (b[1] + b[3]) / 2;
	const dLon = m / mPerDegLon(lat);
	const dLat = m / M_PER_DEG_LAT;
	return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}
const union = (a, b) => [
	Math.min(a[0], b[0]),
	Math.min(a[1], b[1]),
	Math.max(a[2], b[2]),
	Math.max(a[3], b[3])
];
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r5 = (x) => Math.round(x * 1e5) / 1e5;

export function normalize(name) {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[''`’]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

// ---------- Règles de sélection ----------
const EXCLUDED_STATION = new Set(['subway', 'light_rail', 'monorail', 'funicular', 'tram']);
export function isRailStation(t) {
	if (t.railway !== 'station' && t.railway !== 'halt') return false;
	if (!t.name) return false;
	if (EXCLUDED_STATION.has(t.station)) return false;
	if (t.usage === 'tourism' || t.tourism === 'yes') return false;
	if (t.train === 'no') return false;
	return true;
}
export function isTrainPlatform(t) {
	if (t.railway === 'platform') return true;
	if (t.public_transport === 'platform' && (t.train === 'yes' || t.railway === 'platform'))
		return true;
	return false;
}
/** Ancienne pancarte d'arrêt, selon le schéma du pays (statistiques seulement). */
const legacyStopSign = (country) => (t) =>
	t.railway === 'signal' && !!country.stopSigns?.isLegacy(t);

// Rayon de rattachement d'un quai à une gare, marge de l'emprise, emprise sans quai.
const PLATFORM_RADIUS_M = 400;
const MARGIN_M = 60;
const NO_PLATFORM_HALF_M = 200;

// ---------- Lecture ----------
export async function read(file, country = COUNTRIES[DEFAULT_COUNTRY]) {
	const isLegacyStopSign = legacyStopSign(country);
	const stations = [];
	const platforms = [];
	const legacy = [];
	const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	for await (let line of rl) {
		line = line.replace(String.fromCharCode(0x1e), '').trim(); // séparateur RFC 8142
		if (!line) continue;
		const f = JSON.parse(line);
		const t = f.properties ?? {};
		const pts = coordsOf(f.geometry ?? {});
		if (!pts.length) continue;
		const id = f.id ?? t['@id'] ?? '';
		if (isRailStation(t)) {
			const b = bboxOf(pts);
			stations.push({ id: String(id), t, pos: f.geometry.type === 'Point' ? pts[0] : center(b) });
		} else if (isTrainPlatform(t)) {
			platforms.push({ bbox: bboxOf(pts), c: center(bboxOf(pts)) });
		} else if (isLegacyStopSign(t)) {
			legacy.push(pts[0]);
		}
	}
	return { stations, platforms, legacy };
}

// Grille de 0,01° pour trouver rapidement les objets proches.
function grid(items, key) {
	const g = new Map();
	for (const it of items) {
		const [x, y] = key(it);
		const k = `${Math.floor(x * 100)}:${Math.floor(y * 100)}`;
		if (!g.has(k)) g.set(k, []);
		g.get(k).push(it);
	}
	return (p) => {
		const out = [];
		const cx = Math.floor(p[0] * 100),
			cy = Math.floor(p[1] * 100);
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++) out.push(...(g.get(`${cx + dx}:${cy + dy}`) ?? []));
		return out;
	};
}

// Dédoublonnage : même nom normalisé à moins de 300 m → on garde le nœud railway=station.
function dedupe(stations) {
	const near = grid(stations, (s) => s.pos);
	const drop = new Set();
	for (const s of stations) {
		if (drop.has(s)) continue;
		for (const o of near(s.pos)) {
			if (o === s || drop.has(o)) continue;
			if (normalize(o.t.name) === normalize(s.t.name) && distM(o.pos, s.pos) < 300) {
				const score = (x) => (x.id.startsWith('n') ? 2 : 0) + (x.t.railway === 'station' ? 1 : 0);
				drop.add(score(o) > score(s) ? s : o);
				if (drop.has(s)) break;
			}
		}
	}
	return stations.filter((s) => !drop.has(s));
}

// ---------- Communes (géocodage inverse, mis en cache dans le dépôt) ----------
// Un géocodeur par source déclarée dans la configuration du pays (`index.geocoder`) :
// renvoie [commune, subdivision] pour une position, ou undefined.
const UA = { 'User-Agent': 'stationcomplete-stations (+https://stationcomplete.org)' };
const GEOCODERS = {
	// API Géo (France) : commune et code du département ; limite de 50 requêtes par seconde.
	'geo.api.gouv.fr': async ([lon, lat]) => {
		const url = `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement&format=json`;
		const r = await fetch(url, { headers: UA });
		const j = r.ok ? await r.json() : [];
		return j[0] ? [j[0].nom, j[0].codeDepartement] : undefined;
	}
};

async function communes(stations, { geocoder, cachePath, offline }) {
	const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
	const todo = stations.filter((s) => !cache[s.id]);
	const locate = GEOCODERS[geocoder];
	if (geocoder && !locate) throw new Error(`Géocodeur inconnu : « ${geocoder} ».`);
	if (!offline && locate && todo.length) {
		console.log(`Géocodage de ${todo.length} gares nouvelles…`);
		for (let i = 0; i < todo.length; i += 5) {
			await Promise.all(
				todo.slice(i, i + 5).map(async (s) => {
					try {
						const found = await locate(s.pos);
						if (found) cache[s.id] = found;
					} catch {
						/* on réessaiera la semaine prochaine */
					}
				})
			);
			await new Promise((res) => setTimeout(res, 150)); // reste loin de la limite de 50 req/s
		}
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(cache, null, 0));
	}
	return cache;
}

// ---------- Construction ----------
export function build({ stations, platforms, legacy }, cache = {}) {
	const kept = dedupe(stations);
	const nearPlatforms = grid(platforms, (p) => p.c);
	const nearLegacy = grid(legacy, (p) => p);
	let withoutPlatform = [];
	let legacyStations = [];
	const rows = kept.map((s) => {
		const ps = nearPlatforms(s.pos).filter((p) => distM(p.c, s.pos) <= PLATFORM_RADIUS_M);
		let box;
		if (ps.length) {
			box = ps.reduce((b, p) => union(b, p.bbox), [s.pos[0], s.pos[1], s.pos[0], s.pos[1]]);
			box = expand(box, MARGIN_M);
		} else {
			box = expand([s.pos[0], s.pos[1], s.pos[0], s.pos[1]], NO_PLATFORM_HALF_M);
			withoutPlatform.push(s.t.name);
		}
		if (nearLegacy(s.pos).some((p) => distM(p, s.pos) <= PLATFORM_RADIUS_M))
			legacyStations.push(s.t.name);
		const [commune, admin] = cache[s.id] ?? [s.t['addr:city'] ?? '', ''];
		return [
			s.id,
			s.t.name,
			normalize(s.t.name),
			commune,
			admin,
			s.t.uic_ref ?? '',
			r5(s.pos[1]),
			r5(s.pos[0]),
			s.t.railway === 'halt' ? 'H' : 'S',
			box.map(r4)
		];
	});
	rows.sort((a, b) => a[2].localeCompare(b[2]));
	const areas = rows.map(
		(r) => ((r[9][2] - r[9][0]) * mPerDegLon(r[6]) * (r[9][3] - r[9][1]) * M_PER_DEG_LAT) / 1e6
	);
	return {
		index: rows,
		stats: {
			stations: rows.length,
			platforms: platforms.length,
			withoutPlatform: withoutPlatform.length,
			withoutPlatformSample: withoutPlatform.slice(0, 20),
			legacySignStations: legacyStations.length,
			legacySignSample: legacyStations.slice(0, 20),
			empriseKm2: {
				median: +areas.sort((a, b) => a - b)[Math.floor(areas.length / 2)]?.toFixed(3),
				max: +Math.max(0, ...areas).toFixed(3)
			}
		}
	};
}

// ---------- Jauges (11e colonne, facultative) ----------
// Mêmes règles que l'appli : on rassemble pour chaque gare ce que l'API OSM renverrait sur son
// emprise (ways ayant un nœud dans l'emprise, avec tous leurs nœuds ; nœuds étiquetés proches ;
// relations dont un way membre est retenu), puis on appelle analyzeStation (src/lib/core/quests.ts).
// Seuls les objets utiles aux jauges sont dans l'extrait (quais, voies, signaux) : le résultat
// est celui de l'appli pour les données d'OSM au moment de l'extrait, sans les saisies locales.

/** Décode une valeur OPL (« %20% » → espace ; tout point de code peut être échappé ainsi). */
const oplText = (s) =>
	s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Une ligne OPL (format d'osmium) → objet, ou undefined (ligne vide, type inconnu). */
export function parseOpl(line) {
	const parts = line.trim().split(' ');
	const head = parts[0] ?? '';
	const type = { n: 'node', w: 'way', r: 'relation' }[head[0]];
	if (!type) return undefined;
	const o = { type, id: Number(head.slice(1)), tags: undefined };
	for (const f of parts.slice(1)) {
		const v = f.slice(1);
		switch (f[0]) {
			case 'T':
				if (v)
					o.tags = Object.fromEntries(
						v.split(',').map((kv) => {
							const i = kv.indexOf('=');
							return [oplText(kv.slice(0, i)), oplText(kv.slice(i + 1))];
						})
					);
				break;
			case 'x':
				if (v) o.lon = Number(v);
				break;
			case 'y':
				if (v) o.lat = Number(v);
				break;
			case 'N':
				// n12x5.1y46.2 (coordonnées ajoutées par add-locations-to-ways) ou n12 seul
				o.nodes = v
					? v.split(',').map((n) => {
							const m = /^n(-?\d+)(?:x(-?[\d.]+)y(-?[\d.]+))?$/.exec(n);
							return m
								? { id: Number(m[1]), lon: m[2] && Number(m[2]), lat: m[3] && Number(m[3]) }
								: { id: NaN };
						})
					: [];
				break;
			case 'M':
				o.members = v
					? v.split(',').map((m) => {
							const at = m.indexOf('@');
							return {
								type: { n: 'node', w: 'way', r: 'relation' }[m[0]],
								ref: Number(m.slice(1, at)),
								role: oplText(m.slice(at + 1))
							};
						})
					: [];
				break;
		}
	}
	return o;
}

const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

/**
 * Éléments OSM de chaque gare (même tableau que `rows`), lus dans l'extrait OPL. `rows` : lignes
 * de l'index (emprise en colonne 9, celle que l'appli demande à l'API OSM).
 */
export async function collect(file, rows) {
	const m = THRESHOLDS.stopSignMarginM;
	const boxes = rows.map((r) => r[9]);
	// Nœuds étiquetés (pancartes) : emprise élargie de la marge des pancartes, comme l'appli.
	const wide = boxes.map((b) => expand(b, m));
	// Grille de 0,01° : chaque gare est inscrite dans les cases que touche son emprise élargie.
	const cells = new Map();
	wide.forEach((b, i) => {
		for (let x = Math.floor(b[0] * 100); x <= Math.floor(b[2] * 100); x++)
			for (let y = Math.floor(b[1] * 100); y <= Math.floor(b[3] * 100); y++) {
				const k = `${x}:${y}`;
				if (!cells.has(k)) cells.set(k, []);
				cells.get(k).push(i);
			}
	});
	const candidates = (lon, lat) =>
		cells.get(`${Math.floor(lon * 100)}:${Math.floor(lat * 100)}`) ?? [];
	const out = rows.map(() => ({ nodes: new Map(), ways: new Map(), relations: [] }));
	const wayStations = new Map(); // way retenu → gares
	const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	for await (const line of rl) {
		const o = parseOpl(line);
		if (!o) continue;
		if (o.type === 'node') {
			if (!o.tags || o.lon === undefined || o.lat === undefined) continue;
			for (const i of candidates(o.lon, o.lat))
				if (inBox(wide[i], o.lon, o.lat))
					out[i].nodes.set(o.id, { type: 'node', id: o.id, lat: o.lat, lon: o.lon, tags: o.tags });
		} else if (o.type === 'way') {
			const pts = (o.nodes ?? []).filter((n) => Number.isFinite(n.lon) && Number.isFinite(n.lat));
			const hit = new Set();
			for (const n of pts)
				for (const i of candidates(n.lon, n.lat)) if (inBox(boxes[i], n.lon, n.lat)) hit.add(i);
			if (hit.size) wayStations.set(o.id, [...hit]);
			for (const i of hit) {
				const st = out[i];
				st.ways.set(o.id, { type: 'way', id: o.id, nodes: pts.map((n) => n.id), tags: o.tags });
				for (const n of pts)
					if (!st.nodes.has(n.id))
						st.nodes.set(n.id, { type: 'node', id: n.id, lat: n.lat, lon: n.lon });
			}
		} else if (o.members) {
			const hit = new Set(
				o.members.flatMap((x) => (x.type === 'way' ? (wayStations.get(x.ref) ?? []) : []))
			);
			for (const i of hit)
				out[i].relations.push({ type: 'relation', id: o.id, members: o.members, tags: o.tags });
		}
	}
	return out.map((st) => [...st.nodes.values(), ...st.ways.values(), ...st.relations]);
}

/** Jauges d'une gare : [quais faits, total, voies faites, total, côtés faits, total]. */
export function gauges(elements, bbox, code = DEFAULT_COUNTRY) {
	const { platforms, tracks, stopSigns } = analyzeStation(
		elements,
		bbox,
		new Date(),
		code
	).completeness;
	return [
		platforms.done,
		platforms.total,
		tracks.done,
		tracks.total,
		stopSigns.done,
		stopSigns.total
	];
}

/** Ajoute la 11e colonne (jauges) à chaque ligne de l'index. */
export async function addGauges(rows, file, code = DEFAULT_COUNTRY) {
	const all = await collect(file, rows);
	rows.forEach((r, i) => r.push(gauges(all[i], r[9], code)));
	return rows;
}

/** Gares hors de l'emprise approximative du pays (contrôle, statistiques seulement). */
function outside(index, [w, s, e, n]) {
	return index.filter(([, , , , , , lat, lon]) => lon < w || lon > e || lat < s || lat > n);
}

async function main() {
	const input = process.argv[2];
	const code = argValue('--country') ?? DEFAULT_COUNTRY;
	if (!input || input.startsWith('--') || !isCountryCode(code)) {
		console.error(
			'Usage : node scripts/build-stations.mjs rail-<cc>.geojsonseq [--country ' +
				Object.keys(COUNTRIES).join('|') +
				'] [--osm jauges-<cc>.opl]'
		);
		process.exit(2);
	}
	const country = COUNTRIES[code];
	if (!country.enabled) console.warn(`Pays « ${code} » désactivé : index construit pour essai.`);
	const outPath = argValue('--out') ?? `static/${country.index.file}`;
	const cachePath = argValue('--communes') ?? country.index.geocoderCache;
	const statsPath = argValue('--stats') ?? country.index.stats;
	const offline = process.argv.includes('--offline'); // pas de géocodage (tests)

	const data = await read(input, country);
	const cache = await communes(dedupe(data.stations), {
		geocoder: country.index.geocoder,
		cachePath,
		offline
	});
	const { index, stats } = build(data, cache);
	const osm = argValue('--osm');
	if (osm) {
		await addGauges(index, osm, code);
		const todo = index.filter(
			(r) => r[10][1] + r[10][3] + r[10][5] > r[10][0] + r[10][2] + r[10][4]
		);
		stats.gauges = {
			stations: index.length,
			withPlatforms: index.filter((r) => r[10][1] > 0).length,
			incomplete: todo.length
		};
	}
	const far = outside(index, country.bounds);
	stats.outsideBounds = far.length;
	stats.outsideBoundsSample = far.slice(0, 20).map((r) => r[1]);
	const version = new Date().toISOString().slice(0, 10);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(
		outPath,
		JSON.stringify({ v: version, attribution: '© contributeurs OpenStreetMap, ODbL', s: index })
	);
	mkdirSync(dirname(statsPath), { recursive: true });
	writeFileSync(statsPath, JSON.stringify({ v: version, ...stats }, null, 2) + '\n');
	console.log(JSON.stringify(stats, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
