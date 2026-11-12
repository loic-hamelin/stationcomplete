// Configuration par pays (lot P1) : France complète et identique au comportement d'avant,
// pays désactivé jamais sélectionnable, données locales d'avant le lot P1 toujours valides,
// politique de sécurité générée depuis la configuration.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	COUNTRIES,
	DEFAULT_COUNTRY,
	countryConfig,
	countryProblems,
	detectCountry,
	enabledCountries,
	imageryOf,
	imageryOrigins,
	isSelectable,
	photoCredits,
	recordCountry,
	resolveCountry
} from './countries';
import type { Download } from '../offline.svelte';
import { cspDirectives } from './csp';
import type { Edit } from './edits';
import { buildFeatures } from './features';
import type { BBox, OsmElement } from './osm';
import { analyzeStation } from './quests';
import { stationCacheKey } from './storage';
import { frStopSigns } from './stopsigns/fr';
import { stationTiles, tileUrl } from './tiles';
import { changesetTags } from './upload';

// Valeurs d'avant le lot P1 (tiles.ts, style.ts, upload.ts, vite.config.ts), recopiées telles
// quelles : la France doit rester exactement la même.
const IGN_TILE_URL =
	'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
	'&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg' +
	'&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

describe('France', () => {
	const fr = COUNTRIES.fr;
	it('est complète, activée et proposée par défaut', () => {
		expect(countryProblems(fr)).toEqual([]);
		expect(fr.enabled).toBe(true);
		expect(DEFAULT_COUNTRY).toBe('fr');
		expect(enabledCountries().map((c) => c.code)).toEqual(['fr']);
		expect(fr.name).toBe('France');
		expect(fr.ofName).toBe('de France');
		expect(fr.subdivision.singular).toBe('département');
		expect(fr.languages).toEqual(['fr']);
	});
	it('garde la photo IGN d’avant (URL, zoom, poids, attribution, changeset)', () => {
		expect(fr.imagery).toEqual(
			expect.objectContaining({
				tileUrl: IGN_TILE_URL,
				tileSize: 256,
				maxZoom: 19,
				avgTileBytes: 16_000,
				maxParallel: 4,
				origin: 'https://data.geopf.fr',
				attribution: 'Photo © IGN – BD ORTHO',
				imageryUsed: 'BDOrtho IGN'
			})
		);
		expect(photoCredits()).toEqual([
			{
				product: 'IGN – BD ORTHO',
				licence: 'Licence Ouverte 2.0',
				licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
				operator: 'IGN – Géoplateforme',
				operatorSeat: 'France'
			}
		]);
		expect(tileUrl(19, 1, 2)).toBe(
			IGN_TILE_URL.replace('{z}', '19').replace('{x}', '1').replace('{y}', '2')
		);
	});
	it('garde le schéma des pancartes FR:passenger_stop et sa grille E7', () => {
		expect(fr.stopSigns).toBe(frStopSigns);
		expect(frStopSigns.types.map((t) => t.label)).toEqual([
			'TT',
			'n V',
			'L 220',
			'Z57',
			'Z50',
			'TGV',
			'UFR',
			'Train long',
			'Train court',
			'Tous trains',
			'Autre / illisible',
			'US / UM (bientôt)'
		]);
		expect(frStopSigns.types.filter((t) => t.disabled).map((t) => t.t)).toEqual(['US/UM']);
		expect(frStopSigns.ownsKey('railway:signal:stop:highspeed')).toBe(true);
		expect(frStopSigns.ownsKey('railway:signal:direction')).toBe(false);
		expect(fr.quests.misplacedTrackRef.test('Voie 1')).toBe(true);
		expect(fr.quests.misplacedTrackRef.test('1')).toBe(false);
	});
	it('publie son index des gares, dont toutes les gares sont dans son emprise', () => {
		const file = `static/${fr.index.file}`;
		expect(existsSync(file)).toBe(true);
		const rows = JSON.parse(readFileSync(file, 'utf8')).s as [
			string,
			string,
			string,
			string,
			string,
			string,
			number,
			number
		][];
		expect(rows.length).toBeGreaterThan(1000);
		const [w, s, e, n] = fr.bounds;
		const out = rows.filter(([, , , , , , lat, lon]) => lon < w || lon > e || lat < s || lat > n);
		expect(out).toEqual([]);
	});
	it('construit son index avec les mêmes fichiers qu’avant le lot P1', () => {
		expect(fr.index).toEqual({
			file: 'data/stations-fr.json',
			geofabrik: 'europe/france',
			geocoder: 'geo.api.gouv.fr',
			geocoderCache: 'data/communes-cache.json',
			stats: 'data/stations-stats.json'
		});
	});
});

describe('pays désactivé (Suisse)', () => {
	const ch = COUNTRIES.ch;
	it('est décrit sans être activé ni sélectionnable', () => {
		expect(ch.enabled).toBe(false);
		expect(isSelectable('ch')).toBe(false);
		expect(resolveCountry('ch')).toBe('fr');
		expect(enabledCountries().some((c) => c.code === 'ch')).toBe(false);
		expect(imageryOrigins()).not.toContain('https://wmts.geo.admin.ch');
	});
	it('ne pourrait pas être activé tel quel : les valeurs non vérifiées sont vides', () => {
		expect(countryProblems({ ...ch, enabled: true })).toEqual(
			expect.arrayContaining(['index des gares', 'photo aérienne'])
		);
		expect(ch.imagery).toBeNull();
		expect(ch.stopSigns).toBeNull();
		expect(() => imageryOf('ch')).toThrow(/photo aérienne/);
	});
	it('les valeurs lues inconnues retombent sur la France', () => {
		expect(isSelectable('fr')).toBe(true);
		for (const v of [undefined, null, '', 'xx', 'FR', 42, 'toString', '__proto__'])
			expect(resolveCountry(v)).toBe('fr');
		expect(countryConfig('zz').code).toBe('fr');
	});
	it('sans schéma de pancartes : aucune pancarte, ni quête Q4/Q5, ni jauge de pancartes', () => {
		const m = (
			JSON.parse(readFileSync('tests/fixtures/mesures.json', 'utf8')) as {
				name: string;
				fichier: string;
				bbox: BBox;
			}[]
		).find((x) => x.name === 'Ambérieu-en-Bugey')!;
		const raw = JSON.parse(readFileSync(m.fichier, 'utf8'));
		const els = (raw.elements ?? raw) as OsmElement[];
		const now = new Date('2026-11-05');
		const fr = analyzeStation(els, m.bbox, now);
		const ch = analyzeStation(els, m.bbox, now, 'ch');
		expect(fr.country).toBe('fr');
		expect(ch.country).toBe('ch');
		expect(fr.quests.some((q) => q.id === 'Q4')).toBe(true);
		expect(ch.stopSigns).toEqual([]);
		expect(ch.quests.filter((q) => q.id === 'Q4' || q.id === 'Q5')).toEqual([]);
		expect(ch.completeness.stopSigns).toEqual({ done: 0, total: 0 });
		// Quais et voies : mêmes résultats dans les deux pays.
		expect(ch.completeness.platforms).toEqual(fr.completeness.platforms);
		expect(ch.completeness.tracks).toEqual(fr.completeness.tracks);
		const kinds = new Set(buildFeatures(els, ch, m.bbox).features.map((f) => f.properties.kind));
		expect(kinds.has('pancarte')).toBe(false);
	});
});

describe('données locales d’avant le lot P1', () => {
	// Saisie enregistrée au lot 7 : pas de champ `country`.
	const legacy = {
		kind: 'tags',
		id: 'e1',
		station: 'n7034430300',
		createdAt: 1,
		target: 'way/1',
		tags: { 'railway:track_ref': '2' },
		summary: 'Voie 2'
	} as Edit;

	it('les clés du cache local n’ont pas changé (pas de pays dedans)', () => {
		expect(stationCacheKey('prod', 'n7034430300')).toBe('n7034430300');
		expect(stationCacheKey('dev', 'n7034430300')).toBe('dev:n7034430300');
	});
	it('une saisie ou un téléchargement sans pays est français', () => {
		expect(recordCountry(legacy)).toBe('fr');
		// Gare téléchargée au lot 4 (offline.svelte.ts, Download) : pas de champ `country`.
		const download: Download = { id: 'n1', name: 'X', at: 1, tiles: 3, bytes: 4 };
		expect(recordCountry(download)).toBe('fr');
		expect(recordCountry(undefined)).toBe('fr');
		expect(recordCountry({ country: 'ch' })).toBe('ch');
		expect(recordCountry({ country: 'zz' })).toBe('fr');
	});
	it('une saisie sans pays part avec la photo IGN dans le changeset', () => {
		const t = changesetTags({
			comment: 'Gare X',
			version: '0.4',
			survey: false,
			imagery: true,
			country: recordCountry(legacy)
		});
		expect(t.imagery_used).toBe('BDOrtho IGN');
	});
	it('un téléchargement sans pays efface les mêmes tuiles qu’avant', () => {
		const bbox: BBox = [5.3393, 45.9529, 5.3442, 45.9548];
		const im = imageryOf(recordCountry({}));
		const urls = stationTiles(bbox, im).map((t) => tileUrl(t.z, t.x, t.y, im));
		expect(urls.length).toBe(stationTiles(bbox).length);
		expect(urls.every((u) => u.startsWith('https://data.geopf.fr/wmts?'))).toBe(true);
		expect(urls.at(-1)).toContain('TILEMATRIX=19&');
	});
});

describe('politique de sécurité générée', () => {
	it('autorise la photo IGN, et elle seule comme fournisseur de photos', () => {
		const d = cspDirectives();
		expect(d['img-src']).toContain('https://data.geopf.fr');
		expect(d['connect-src']).toContain('https://data.geopf.fr');
	});
	it('est la politique écrite à la main avant le lot P1, plus l’état officiel SNCF', () => {
		expect(cspDirectives()).toEqual({
			'default-src': ['self'],
			'script-src': ['self'],
			'style-src': ['self', 'unsafe-inline'],
			'img-src': ['self', 'data:', 'blob:', 'https://data.geopf.fr'],
			'font-src': ['self'],
			'connect-src': [
				'self',
				'https://api.openstreetmap.org',
				'https://www.openstreetmap.org',
				'https://master.apis.dev.openstreetmap.org',
				'https://data.geopf.fr',
				// D4 bis (lot S1) : état officiel des ascenseurs, lecture seule
				'https://ressources.data.sncf.com'
			],
			'worker-src': ['self', 'blob:'],
			'manifest-src': ['self'],
			'base-uri': ['self'],
			'form-action': ['self'],
			'object-src': ['none']
		});
	});
	it('n’autorise l’état officiel qu’en lecture (connect-src), pour les pays activés seulement', () => {
		const d = cspDirectives();
		expect(d['img-src']).not.toContain('https://ressources.data.sncf.com');
		expect(cspDirectives(['https://data.geopf.fr'], [])['connect-src']).not.toContain(
			'https://ressources.data.sncf.com'
		);
		// La Suisse, désactivée, n'a pas encore de source : rien à ajouter.
		expect(COUNTRIES.ch.equipmentStatus).toBeNull();
	});
	it('ajoute l’origine d’un nouveau fournisseur sans autre changement', () => {
		const d = cspDirectives(['https://data.geopf.fr', 'https://tuiles.example.org']);
		expect(d['img-src']).toContain('https://tuiles.example.org');
		expect(d['connect-src']).toContain('https://tuiles.example.org');
	});
});

describe('pays proposé au premier lancement (sans localisation)', () => {
	const both = [COUNTRIES.fr, { ...COUNTRIES.ch, enabled: true }];
	it('d’après le fuseau horaire, puis la région de la langue', () => {
		expect(detectCountry({ timeZone: 'Europe/Zurich', languages: ['fr-FR'] }, both)).toBe('ch');
		expect(detectCountry({ timeZone: 'Europe/Paris', languages: ['de-CH'] }, both)).toBe('fr');
		expect(detectCountry({ timeZone: 'America/Montreal', languages: ['en', 'fr-CH'] }, both)).toBe(
			'ch'
		);
		expect(detectCountry({ timeZone: 'Asia/Tokyo', languages: ['ja-JP'] }, both)).toBe('fr');
		expect(detectCountry({}, both)).toBe('fr');
	});
	it('seuls les pays activés sont proposés (France seule aujourd’hui)', () => {
		expect(detectCountry({ timeZone: 'Europe/Zurich', languages: ['de-CH'] })).toBe('fr');
		expect(enabledCountries().map((c) => c.code)).toEqual(['fr']);
	});
	it('noms des départements pour toutes les subdivisions de l’index', async () => {
		const names = (await COUNTRIES.fr.subdivision.names!()).default;
		const index = JSON.parse(readFileSync('static/data/stations-fr.json', 'utf8')) as {
			s: string[][];
		};
		const codes = new Set(index.s.map((r) => r[4]).filter(Boolean));
		expect([...codes].filter((c) => !names[c])).toEqual([]);
		expect(names['01']).toBe('Ain');
	});
});
