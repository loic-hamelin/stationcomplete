// Lot « Équipements », étape 3 : escaliers et escaliers mécaniques existants — sens relatif au
// way (jamais retourné), mains courantes, bandes podotactiles, quêtes Q10 et Q11.
import { describe, expect, it } from 'vitest';
import { LocalProjection } from './geo';
import type { OsmElement } from './osm';
import { analyzeStation } from './quests';
import { arrowOf, parseStepCount, stepsMissing, stepsTags, stepsValue, wayKindOf } from './steps';
import { applyEdits, type TagEdit } from './edits';
import { planUpload, osmChangeXml, proposedComment } from './upload';

describe('reconnaissance', () => {
	it('escalier, escalier mécanique (steps + conveying), tapis roulant (footway + conveying)', () => {
		expect(wayKindOf({ highway: 'steps' })).toBe('stairs');
		expect(wayKindOf({ highway: 'steps', conveying: 'yes' })).toBe('escalator');
		expect(wayKindOf({ highway: 'steps', conveying: 'no' })).toBe('stairs');
		expect(wayKindOf({ highway: 'footway', conveying: 'forward' })).toBe('walkway');
		expect(wayKindOf({ highway: 'footway' })).toBeUndefined();
	});
	it('questions sans réponse ; conveying=yes = sens inconnu', () => {
		expect(stepsMissing('stairs', { highway: 'steps' })).toEqual([
			'incline',
			'handrail',
			'tactile'
		]);
		expect(
			stepsMissing('stairs', { incline: 'up', 'handrail:left': 'yes', tactile_paving: 'no' })
		).toEqual([]);
		expect(stepsMissing('escalator', { conveying: 'yes', incline: 'down' })).toEqual(['conveying']);
		expect(stepsValue('incline', { incline: '-30%' })).toBe('down');
	});
});

describe('tags écrits, relatifs au sens du way', () => {
	it('sens de montée et sens de marche : valeurs du wiki, rien d’autre', () => {
		expect(stepsTags('stairs', { incline: 'down' }, { highway: 'steps' })).toEqual({
			incline: 'down'
		});
		expect(stepsTags('escalator', { conveying: 'backward', incline: 'up' }, {})).toEqual({
			conveying: 'backward',
			incline: 'up'
		});
		// Un tapis roulant n'a pas de question « monte/descend ».
		expect(stepsTags('walkway', { incline: 'up', conveying: 'forward' }, {})).toEqual({
			conveying: 'forward'
		});
	});
	it('mains courantes : handrail + côtés en suivant la flèche ; « aucune » contredit les côtés', () => {
		expect(stepsTags('stairs', { handrail: 'left' }, {})).toEqual({
			handrail: 'yes',
			'handrail:left': 'yes',
			'handrail:right': 'no'
		});
		expect(stepsTags('stairs', { handrail: 'both' }, { handrail: 'yes' })).toEqual({
			'handrail:left': 'yes',
			'handrail:right': 'yes'
		});
		expect(stepsTags('stairs', { handrail: 'no' }, { 'handrail:right': 'yes' })).toEqual({
			handrail: 'no',
			'handrail:right': 'no'
		});
	});
	it('« Je ne sais pas » n’écrit rien ; nombre de marches contrôlé', () => {
		expect(stepsTags('stairs', {}, { incline: 'up' })).toEqual({});
		expect(stepsTags('stairs', { incline: 'up' }, { incline: 'up' })).toEqual({});
		expect(parseStepCount('24')).toBe(24);
		expect(parseStepCount('')).toBeUndefined();
		expect(parseStepCount('vingt')).toBeNaN();
		expect(parseStepCount('0')).toBeNaN();
		expect(stepsTags('stairs', { stepCount: '24' }, {})).toEqual({ step_count: '24' });
	});
	it('flèche de la carte : vers le haut (escalier), sens de marche (escalier mécanique)', () => {
		expect(arrowOf('stairs', { incline: 'up' })).toBe('forward');
		expect(arrowOf('stairs', { incline: 'down' })).toBe('backward');
		expect(arrowOf('stairs', {})).toBeUndefined();
		expect(arrowOf('escalator', { conveying: 'backward', incline: 'up' })).toBe('backward');
		expect(arrowOf('escalator', { conveying: 'reversible', incline: 'up' })).toBe('forward');
		expect(arrowOf('walkway', { conveying: 'reversible' })).toBeUndefined();
	});
});

describe('analyse et envoi', () => {
	const proj = new LocalProjection(5.36, 45.96);
	const node = (id: number, x: number, y: number): OsmElement => {
		const [lon, lat] = proj.unproject({ x, y });
		return { type: 'node', id, lon, lat };
	};
	const els: OsmElement[] = [
		node(1, 0, 0),
		node(2, 5, 0),
		node(3, 0, 5),
		node(4, 5, 5),
		{ type: 'way', id: 10, version: 4, nodes: [1, 2], tags: { highway: 'steps' } },
		{ type: 'way', id: 11, version: 2, nodes: [3, 4], tags: { highway: 'steps', conveying: 'yes' } }
	];
	const [w, s] = proj.unproject({ x: -100, y: -100 });
	const [e, n] = proj.unproject({ x: 100, y: 100 });

	it('Q10 pour l’escalier, Q11 pour l’escalier mécanique ; pas de jauge', () => {
		const r = analyzeStation(els, [w, s, e, n]);
		expect(r.steps.map((x) => [x.way, x.kind])).toEqual([
			[10, 'stairs'],
			[11, 'escalator']
		]);
		expect(r.quests.filter((q) => q.id === 'Q10').map((q) => q.target?.id)).toEqual([10]);
		expect(r.quests.filter((q) => q.id === 'Q11').map((q) => q.target?.id)).toEqual([11]);
		expect(r.completeness.equipment.total).toBe(0);
	});
	it('sens complété : seuls les tags changent, la liste de nœuds du way ne bouge pas', () => {
		const edit: TagEdit = {
			kind: 'tags',
			id: 'e',
			station: 's',
			createdAt: 0,
			target: 'way/10',
			version: 4,
			tags: { incline: 'down', check_date: '2026-11-11' },
			summary: 'Escalier : sens de montée',
			family: 'equip'
		};
		const plan = planUpload([edit], els);
		const xml = osmChangeXml(1, plan);
		expect(xml).toContain(
			'<way id="10" version="4" changeset="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="steps"/><tag k="incline" v="down"/>'
		);
		const local = applyEdits(els, [edit]).find((x) => x.type === 'way' && x.id === 10);
		expect(local).toMatchObject({ nodes: [1, 2], tags: { incline: 'down' } });
		expect(proposedComment('Gare', [edit])).toContain('escaliers complétés');
		expect(proposedComment('Gare', [edit])).not.toContain('numéros');
	});
});
