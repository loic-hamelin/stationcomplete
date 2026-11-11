// Construction de l'index des gares par pays (lot P1), sur un petit extrait de fixture
// (tests/fixtures/rail-mini.geojsonseq) : aucun téléchargement, aucun géocodage.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../src/lib/core/countries';
import type { BBox, OsmElement, OsmNode, OsmWay } from '../src/lib/core/osm';
import { analyzeStation } from '../src/lib/core/quests';
import { addGauges, build, collect, parseOpl, read } from './build-stations.mjs';
import { matrix, problems } from './countries.mjs';

const FIXTURE = 'tests/fixtures/rail-mini.geojsonseq';
const OPL = 'tests/fixtures/rail-mini.opl';

type Row = [string, string, string, string, string, string, number, number, 'S' | 'H', number[]];

describe('index des gares : construction', () => {
	it('sélectionne, dédoublonne et décrit les gares (France)', async () => {
		const data = await read(FIXTURE, COUNTRIES.fr);
		const { index, stats } = build(data, {});
		const rows = index as Row[];
		// Métro et train touristique exclus ; la gare en double (way) cède la place au nœud.
		expect(rows.map((r) => r[1])).toEqual(['Gare d’Essai', 'Gare Lointaine', 'Halte du Sud']);
		const gare = rows[0];
		expect(gare.slice(0, 9)).toEqual([
			'n1',
			'Gare d’Essai',
			'gare d essai',
			'Essaiville', // addr:city, faute de géocodage
			'', // subdivision inconnue sans géocodage
			'87000001',
			46,
			5,
			'S'
		]);
		expect(rows[2][8]).toBe('H');
		// Emprise : le quai voisin plus la marge.
		const [w, s, e, n] = gare[9];
		expect(w).toBeLessThan(4.9996);
		expect(e).toBeGreaterThan(5.0004);
		expect(s).toBeLessThan(46);
		expect(n).toBeGreaterThan(46.0003);
		expect(stats.platforms).toBe(1);
		expect(stats.withoutPlatform).toBe(2);
		// Ancienne pancarte selon le schéma du pays : FR:ARRET_* oui, FR:ARRET seul non.
		expect(stats.legacySignStations).toBe(1);
		expect(stats.legacySignSample).toEqual(['Gare d’Essai']);
	});

	it('sans schéma de pancartes, aucune ancienne pancarte n’est comptée', async () => {
		const data = await read(FIXTURE, COUNTRIES.ch);
		expect(data.legacy).toEqual([]);
		expect(build(data, {}).index).toHaveLength(3);
	});

	it('en ligne de commande : fichiers du pays, contrôle de l’emprise', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rc-index-'));
		const out = join(dir, 'stations.json');
		const stats = join(dir, 'stats.json');
		execFileSync(
			'node',
			[
				'scripts/build-stations.mjs',
				FIXTURE,
				'--country',
				'fr',
				'--offline',
				'--out',
				out,
				'--stats',
				stats,
				'--communes',
				join(dir, 'communes.json'),
				'--osm',
				OPL
			],
			{ stdio: 'pipe' }
		);
		const json = JSON.parse(readFileSync(out, 'utf8'));
		expect(Object.keys(json)).toEqual(['v', 'attribution', 's']);
		expect(json.s).toHaveLength(3);
		// Jauges en 11e colonne (avec --osm).
		expect(json.s.map((r: unknown[]) => r[10])).toEqual([
			[1, 1, 1, 2, 1, 2],
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0]
		]);
		const st = JSON.parse(readFileSync(stats, 'utf8'));
		expect(st.gauges).toEqual({ stations: 3, withPlatforms: 1, incomplete: 1 });
		expect(st.outsideBounds).toBe(1);
		expect(st.outsideBoundsSample).toEqual(['Gare Lointaine']);
	});

	it('refuse un pays inconnu', () => {
		const r = spawnSync('node', ['scripts/build-stations.mjs', FIXTURE, '--country', 'zz'], {
			encoding: 'utf8'
		});
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/--country fr\|ch/);
	});
});

describe('index des gares : jauges (quais, voies, pancartes)', () => {
	it('lit le format OPL d’osmium (coordonnées dans les ways, échappements)', () => {
		expect(parseOpl('w21 v1 Trailway=rail,name=Voie%20%Sud Nn22x4.999y46.00015,n23')).toEqual({
			type: 'way',
			id: 21,
			tags: { railway: 'rail', name: 'Voie Sud' },
			nodes: [
				{ id: 22, lon: 4.999, lat: 46.00015 },
				{ id: 23, lon: undefined, lat: undefined }
			]
		});
		expect(parseOpl('r5 v2 Ttype=multipolygon Mw1@outer,w2@')).toMatchObject({
			type: 'relation',
			members: [
				{ type: 'way', ref: 1, role: 'outer' },
				{ type: 'way', ref: 2, role: '' }
			]
		});
		expect(parseOpl('n1 v1 T x1.5 y2')).toEqual({
			type: 'node',
			id: 1,
			tags: undefined,
			lon: 1.5,
			lat: 2
		});
		expect(parseOpl('')).toBeUndefined();
	});

	it('mêmes règles que l’appli : quai numéroté, une voie sur deux, un côté sur deux', async () => {
		const { index } = build(await read(FIXTURE, COUNTRIES.fr), {});
		const rows = (await addGauges(index, OPL, 'fr')) as unknown[][];
		// Gare d’Essai : quai « 1;2 » ; voie nord numérotée (2), voie sud non ; pancarte côté nord.
		expect(rows[0][10]).toEqual([1, 1, 1, 2, 1, 2]);
		// Sans quai dans OSM : tout à zéro (la quête « dessiner un quai » reste à faire).
		expect(rows[2][10]).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it('pays sans schéma de pancartes : aucun côté de quai compté', async () => {
		const { index } = build(await read(FIXTURE, COUNTRIES.ch), {});
		const rows = (await addGauges(index, OPL, 'ch')) as unknown[][];
		expect(rows[0][10]).toEqual([1, 1, 1, 2, 0, 0]);
	});

	// Gare de référence réelle (réponse de l'API OSM) réécrite comme le ferait osmium (filtre
	// des quais, voies et signaux, puis add-locations-to-ways) : le script doit trouver
	// exactement les jauges de l'appli.
	it('Ambérieu-en-Bugey : jauges identiques à celles de l’appli', async () => {
		const mesures = JSON.parse(readFileSync('tests/fixtures/mesures.json', 'utf8')) as {
			name: string;
			fichier: string;
			bbox: BBox;
		}[];
		const m = mesures.find((x) => x.name === 'Ambérieu-en-Bugey')!;
		const elements = JSON.parse(readFileSync(m.fichier, 'utf8')).elements as OsmElement[];
		const opl = toOpl(elements);
		const dir = mkdtempSync(join(tmpdir(), 'rc-opl-'));
		writeFileSync(join(dir, 'a.opl'), opl);
		const row = ['w1', 'Ambérieu-en-Bugey', '', '', '', '', 0, 0, 'S', m.bbox];
		const [found] = await collect(join(dir, 'a.opl'), [row]);
		const expected = analyzeStation(elements, m.bbox, new Date(), 'fr').completeness;
		const got = analyzeStation(found as OsmElement[], m.bbox, new Date(), 'fr').completeness;
		expect(got).toEqual(expected);
		expect(expected.platforms.total).toBe(4);
		const rows = (await addGauges([row], join(dir, 'a.opl'), 'fr')) as unknown[][];
		const c = expected;
		expect(rows[0][10]).toEqual([
			c.platforms.done,
			c.platforms.total,
			c.tracks.done,
			c.tracks.total,
			c.stopSigns.done,
			c.stopSigns.total
		]);
	});

	// Quai en plusieurs parties (gare synthétique « type Saint-Lazare ») : l'index compte chaque
	// quai une fois, comme l'appli.
	it('quai coupé en parties couvertes : compté une fois dans l’index', async () => {
		const fx = JSON.parse(readFileSync('tests/fixtures/saint-lazare-type.json', 'utf8')) as {
			station: { bbox: BBox };
			elements: OsmElement[];
		};
		const dir = mkdtempSync(join(tmpdir(), 'rc-opl-'));
		writeFileSync(join(dir, 'sl.opl'), toOpl(fx.elements));
		const row = ['n3533789791', 'Paris-Saint-Lazare', '', '', '', '', 0, 0, 'S', fx.station.bbox];
		const rows = (await addGauges([row], join(dir, 'sl.opl'), 'fr')) as unknown[][];
		// 2 quais (en 3 et 2 parties), dont 1 numéroté ; 6 tronçons de voie ; 4 côtés de quai.
		expect(rows[0][10]).toEqual([1, 2, 0, 6, 0, 4]);
		const c = analyzeStation(fx.elements, fx.station.bbox, new Date(), 'fr').completeness;
		expect(rows[0][10]).toEqual([
			c.platforms.done,
			c.platforms.total,
			c.tracks.done,
			c.tracks.total,
			c.stopSigns.done,
			c.stopSigns.total
		]);
	});
});

/** Extrait OPL tel que le produit la CI : filtre osmium puis add-locations-to-ways. */
function toOpl(elements: OsmElement[]) {
	const esc = (s: string) =>
		[...s]
			.map((ch) => (/[\s,=@%]/.test(ch) ? `%${ch.codePointAt(0)!.toString(16)}%` : ch))
			.join('');
	const tags = (t?: Record<string, string>) =>
		'T' +
		Object.entries(t ?? {})
			.map(([k, v]) => `${esc(k)}=${esc(v)}`)
			.join(',');
	const keep = (e: OsmElement) => {
		const t = e.tags ?? {};
		return (
			['station', 'halt', 'platform'].includes(t.railway) ||
			t.public_transport === 'platform' ||
			(e.type === 'way' && t.railway === 'rail') ||
			(e.type === 'node' && t.railway === 'signal')
		);
	};
	const nodes = new Map<number, OsmNode>();
	const ways = new Map<number, OsmWay>();
	for (const e of elements) if (e.type === 'node') nodes.set(e.id, e);
	for (const e of elements) if (e.type === 'way') ways.set(e.id, e);
	const keptWays = new Set([...ways.values()].filter(keep).map((w) => w.id));
	const rels = elements.filter((e) => e.type === 'relation' && keep(e));
	// Objets référencés (comportement par défaut de « osmium tags-filter ») : ways membres.
	for (const r of rels)
		if (r.type === 'relation')
			for (const mb of r.members) if (mb.type === 'way' && ways.has(mb.ref)) keptWays.add(mb.ref);
	const refNodes = new Set([...keptWays].flatMap((id) => ways.get(id)!.nodes));
	const lines: string[] = [];
	// add-locations-to-ways : seuls les nœuds étiquetés restent.
	for (const n of nodes.values())
		if (n.tags && Object.keys(n.tags).length && (keep(n) || refNodes.has(n.id)))
			lines.push(`n${n.id} v1 ${tags(n.tags)} x${n.lon} y${n.lat}`);
	for (const id of keptWays) {
		const w = ways.get(id)!;
		const ns = w.nodes.map((nid) => {
			const n = nodes.get(nid);
			return n ? `n${nid}x${n.lon}y${n.lat}` : `n${nid}`;
		});
		lines.push(`w${id} v1 ${tags(w.tags)} N${ns.join(',')}`);
	}
	for (const r of rels)
		if (r.type === 'relation')
			lines.push(
				`r${r.id} v1 ${tags(r.tags)} M${r.members.map((mb) => `${mb.type[0]}${mb.ref}@${esc(mb.role)}`).join(',')}`
			);
	return lines.join('\n') + '\n';
}

describe('pays activés pour la CI', () => {
	it('une entrée de matrice par pays activé (France seule)', () => {
		expect(matrix()).toEqual([
			{
				code: 'fr',
				geofabrik: 'europe/france',
				file: 'static/data/stations-fr.json',
				cache: 'data/communes-cache.json',
				stats: 'data/stations-stats.json'
			}
		]);
		expect(problems()).toEqual([]);
	});
	it('un pays précis sur demande, seulement si son extrait Geofabrik est connu', () => {
		expect(matrix(['fr']).map((c) => c.code)).toEqual(['fr']);
		expect(() => matrix(['ch'])).toThrow(/Geofabrik/);
		expect(() => matrix(['zz'])).toThrow(/inconnu/);
	});
});
