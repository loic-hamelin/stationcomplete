// Lot « Équipements », étape 1 : caractéristiques des quais (hauteur, écrans, abri, bandes
// podotactiles, bancs) — lecture, quête Q8, tags écrits, quai en plusieurs parties.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	formatHeight,
	heightProblem,
	itemValue,
	parseHeight,
	platformEquipment,
	platformEquipmentTags,
	COVERED_OMIT,
	type EquipmentPart
} from './equipment';
import { applyEdits, type TagEdit } from './edits';
import { LocalProjection } from './geo';
import type { BBox, OsmElement, Tags } from './osm';
import { analyzeStation, partKeys } from './quests';
import { osmChangeXml, planUpload } from './upload';

describe('hauteur du quai', () => {
	it('lit les mètres, la virgule, les centimètres', () => {
		expect(parseHeight('0,55')).toBe(0.55);
		expect(parseHeight('0.76 m')).toBe(0.76);
		expect(parseHeight('92 cm')).toBe(0.92);
		expect(parseHeight('55')).toBe(0.55);
		expect(parseHeight(' 1 ')).toBe(1);
		expect(parseHeight('haut')).toBeUndefined();
		expect(parseHeight('')).toBeUndefined();
	});
	it('valeur OSM : point décimal, sans zéro inutile', () => {
		expect(formatHeight(0.55)).toBe('0.55');
		expect(formatHeight(0.9)).toBe('0.9');
		expect(formatHeight(1)).toBe('1');
	});
	it('contrôle : vide = « Je ne sais pas », sinon format et plage plausible', () => {
		expect(heightProblem('')).toBeUndefined();
		expect(heightProblem(undefined)).toBeUndefined();
		expect(heightProblem('0,38')).toBeUndefined();
		expect(heightProblem('abc')).toBe('format');
		expect(heightProblem('3')).toBe('range');
		expect(heightProblem('0.05')).toBe('range');
	});
});

describe('valeurs connues', () => {
	it('écrans : passenger_information_display, ou departures_board à défaut', () => {
		expect(itemValue('display', { passenger_information_display: 'no' })).toBe('no');
		expect(itemValue('display', { departures_board: 'realtime' })).toBe('yes');
		// Horaires imprimés, ou tableau sans précision : rien sur les écrans.
		expect(itemValue('display', { departures_board: 'timetable' })).toBeUndefined();
		expect(itemValue('display', { departures_board: 'yes' })).toBeUndefined();
		expect(itemValue('display', { departures_board: 'no' })).toBe('no');
		expect(itemValue('display', {})).toBeUndefined();
	});
	it('hauteur « 0,55 » (virgule) lue comme 0.55', () => {
		expect(itemValue('height', { height: '0,55' })).toBe('0.55');
	});
});

describe('platformEquipment (quête Q8)', () => {
	const open = (tags: Tags = {}) => ({ tags, covered: false });
	const covered = (tags: Tags = {}) => ({ tags, covered: true });

	it('tout manque sur un quai nu', () => {
		const e = platformEquipment([open()]);
		expect(e.missing).toEqual(['height', 'display', 'shelter', 'tactile', 'bench']);
		expect(e.shelterApplies).toBe(true);
	});
	it('bord de quai relié : hauteur et bandes connues ; abri et banc cartographiés à part', () => {
		const e = platformEquipment([open({ passenger_information_display: 'yes' })], {
			edges: [{ railway: 'platform_edge', height: '0.76', tactile_paving: 'yes' }],
			shelterMapped: true,
			benchMapped: true
		});
		expect(e.missing).toEqual([]);
		expect(e.known).toEqual({
			height: '0.76',
			display: 'yes',
			shelter: 'yes',
			tactile: 'yes',
			bench: 'yes'
		});
	});
	it('quai en plusieurs parties : une partie sans la valeur suffit à la demander', () => {
		const e = platformEquipment([open({ bench: 'yes' }), covered({})]);
		expect(e.missing).toContain('bench');
		expect(e.known.bench).toBe('yes');
	});
	it('abri : seulement les parties à l’air libre ; quai entièrement couvert, pas de question', () => {
		const e = platformEquipment([open({ shelter: 'no' }), covered({})]);
		expect(e.missing).not.toContain('shelter');
		const all = platformEquipment([covered({})]);
		expect(all.shelterApplies).toBe(false);
		expect(all.missing).not.toContain('shelter');
	});
});

describe('platformEquipmentTags', () => {
	const parts = [{ tags: { height: '0,55', bench: 'yes' }, covered: false }];
	it('« Je ne sais pas » n’écrit rien et ne retire rien', () => {
		expect(platformEquipmentTags({}, parts)).toEqual({});
	});
	it('n’écrit que ce qui change ; normalise la hauteur', () => {
		expect(
			platformEquipmentTags(
				{ height: '0,55', bench: 'yes', shelter: 'no', display: 'yes', tactile: 'no' },
				parts
			)
		).toEqual({
			height: '0.55',
			shelter: 'no',
			passenger_information_display: 'yes',
			tactile_paving: 'no'
		});
	});
	it('écrans connus par departures_board : « Oui » ne réécrit rien', () => {
		const p: EquipmentPart[] = [{ tags: { departures_board: 'realtime' }, covered: false }];
		expect(platformEquipmentTags({ display: 'yes' }, p)).toEqual({});
		// « Non » sur place contredit realtime : la valeur est retirée.
		expect(platformEquipmentTags({ display: 'no' }, p)).toEqual({
			passenger_information_display: 'no',
			departures_board: null
		});
		const timetable: EquipmentPart[] = [
			{ tags: { departures_board: 'timetable' }, covered: false }
		];
		expect(platformEquipmentTags({ display: 'no' }, timetable)).toEqual({
			passenger_information_display: 'no'
		});
	});
	it('hauteur hors plage ou illisible : rien d’écrit', () => {
		expect(platformEquipmentTags({ height: '7' }, parts)).toEqual({});
		expect(platformEquipmentTags({ height: 'x' }, parts)).toEqual({});
	});
	it('abri déjà renseigné sur toutes les parties à l’air libre : rien à écrire', () => {
		const p: EquipmentPart[] = [
			{ tags: { shelter: 'yes' }, covered: false },
			{ tags: {}, covered: true }
		];
		expect(platformEquipmentTags({ shelter: 'yes' }, p)).toEqual({});
		expect(COVERED_OMIT).toEqual(['shelter']);
	});
});

// Petite gare : un quai polygonal de 200 × 4 m entre deux voies, un bord de quai relié, un abri.
const proj = new LocalProjection(5.36, 45.96);
function smallStation(extra: (node: (x: number, y: number, t?: Tags) => number) => OsmElement[]) {
	let id = 1;
	const els: OsmElement[] = [];
	const node = (x: number, y: number, tags?: Tags) => {
		const [lon, lat] = proj.unproject({ x, y });
		els.push({ type: 'node', id, lon, lat, tags });
		return id++;
	};
	const ring = [node(-100, 2), node(100, 2), node(100, -2), node(-100, -2)];
	els.push({
		type: 'way',
		id: 500,
		nodes: [...ring, ring[0]],
		tags: { railway: 'platform', public_transport: 'platform', ref: '1' }
	});
	for (const [wid, y] of [
		[501, 4],
		[502, -4]
	] as const)
		els.push({
			type: 'way',
			id: wid,
			nodes: [node(-300, y), node(300, y)],
			tags: { railway: 'rail' }
		});
	els.push(...extra(node));
	// Le bord de quai réutilise deux nœuds du contour.
	els.push({
		type: 'way',
		id: 503,
		nodes: [ring[0], ring[1]],
		tags: { railway: 'platform_edge', height: '0.55' }
	});
	const [w, s] = proj.unproject({ x: -400, y: -300 });
	const [e, n] = proj.unproject({ x: 400, y: 300 });
	return { els, bbox: [w, s, e, n] as BBox };
}

describe('analyzeStation : Q8', () => {
	it('abri cartographié sur le quai et hauteur du bord de quai : déjà connus', () => {
		// Abri (amenity=shelter) posé à l'intérieur du quai.
		const s = smallStation((node) => {
			node(20, 0, { amenity: 'shelter' });
			return [];
		});
		const r = analyzeStation(s.els, s.bbox, new Date('2026-11-11'));
		const q8 = r.quests.find((q) => q.id === 'Q8');
		expect(q8?.details?.missing).toEqual(['display', 'tactile', 'bench']);
		expect(r.platforms[0].equipment.known).toMatchObject({ height: '0.55', shelter: 'yes' });
	});
	it('les trois jauges de l’index ne bougent pas', () => {
		const s = smallStation(() => []);
		const r = analyzeStation(s.els, s.bbox, new Date('2026-11-11'));
		expect(r.completeness.platforms).toEqual({ done: 1, total: 1 });
		expect(r.completeness.equipment).toEqual({ done: 0, total: 1 });
	});
});

describe('quai en plusieurs parties (type Saint-Lazare) : abri seulement à l’air libre', () => {
	const fixture = JSON.parse(readFileSync('tests/fixtures/saint-lazare-type.json', 'utf8'));
	const els = fixture.elements as OsmElement[];
	const a = analyzeStation(els, fixture.station.bbox, new Date('2026-11-11'));
	const P = a.platforms.find((p) => p.parts?.length === 3)!;

	it('Q8 sur le quai entier, abri demandé (une partie à l’air libre)', () => {
		expect(P.equipment.shelterApplies).toBe(true);
		const q8 = a.quests.filter((q) => q.id === 'Q8' && q.target?.id === P.ref.id);
		expect(q8).toHaveLength(1);
	});

	it('une saisie : mêmes tags sur chaque partie, sauf l’abri sur les parties couvertes', () => {
		const tags = {
			...platformEquipmentTags(
				{ height: '0,92', shelter: 'yes', bench: 'no' },
				P.parts!.map((p) => ({ tags: p.tags, covered: p.covered }))
			),
			check_date: '2026-11-11'
		};
		expect(tags).toEqual({ height: '0.92', shelter: 'yes', bench: 'no', check_date: '2026-11-11' });
		const [main, ...rest] = partKeys(P);
		const version = (k: string) => els.find((e) => `${e.type}/${e.id}` === k)?.version;
		const edit: TagEdit = {
			kind: 'tags',
			id: 'e1',
			station: fixture.station.id,
			createdAt: 0,
			target: main,
			version: version(main),
			tags,
			parts: rest.map((k) => ({
				target: k,
				version: version(k),
				...(P.parts!.find((x) => `${x.ref.type}/${x.ref.id}` === k)?.covered
					? { omit: COVERED_OMIT }
					: {})
			})),
			summary: 'Quai : équipements'
		};
		// Vue locale
		const local = applyEdits(els, [edit]);
		const tagsOf = (k: string) => local.find((e) => `${e.type}/${e.id}` === k)?.tags ?? {};
		expect(tagsOf(main)).toMatchObject({ height: '0.92', shelter: 'yes', bench: 'no' });
		for (const k of rest) {
			expect(tagsOf(k)).toMatchObject({ height: '0.92', bench: 'no' });
			expect(tagsOf(k).shelter).toBeUndefined();
		}
		// Envoi : un <modify> par partie, l'abri seulement sur la partie à l'air libre.
		const fresh = els.filter((e) => [main, ...rest].includes(`${e.type}/${e.id}` as never));
		const plan = planUpload([edit], fresh);
		expect(plan.conflicts).toEqual([]);
		expect(plan.modify).toHaveLength(3);
		const xml = osmChangeXml(42, plan);
		expect(xml.match(/k="shelter"/g)).toHaveLength(1);
		expect(xml.match(/k="height" v="0.92"/g)).toHaveLength(3);
		const mainXml = xml.slice(xml.indexOf(`<way id="${main.slice(4)}"`));
		expect(mainXml.slice(0, mainXml.indexOf('</way>'))).toContain('k="shelter" v="yes"');
	});
});
