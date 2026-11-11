// Lot « Équipements », étape 2 : ascenseurs et distributeurs de billets (nœuds isolés),
// placement relatif au quai, doublons, envoi et suppression.
import { describe, expect, it } from 'vitest';
import { LocalProjection, pointInPolygon } from './geo';
import {
	cleanLevel,
	levelOk,
	nearbySame,
	newPointTags,
	platformFrame,
	pointKindOf,
	pointTagChanges
} from './points';
import { applyEdits, mergeEdit, type PointDeleteEdit, type PointEdit, type TagEdit } from './edits';
import type { OsmElement } from './osm';
import { osmChangeXml, planUpload, pointsToCheck, proposedComment } from './upload';
import { analyzeStation } from './quests';

const proj = new LocalProjection(5.36, 45.96);
const ll = (x: number, y: number) => proj.unproject({ x, y });

describe('reconnaissance et tags', () => {
	it('ascenseur et distributeur de billets (vending peut être une liste)', () => {
		expect(pointKindOf({ highway: 'elevator' })).toBe('elevator');
		expect(
			pointKindOf({ amenity: 'vending_machine', vending: 'drinks;public_transport_tickets' })
		).toBe('ticket');
		expect(pointKindOf({ amenity: 'vending_machine', vending: 'drinks;sweets' })).toBeUndefined();
	});
	it('niveaux : nettoyés, contrôlés', () => {
		expect(cleanLevel(' -1 ; 0 ')).toBe('-1;0');
		// Une virgule sépare des niveaux (« -1, 0 »), comme le point-virgule.
		expect(cleanLevel('-1, 0')).toBe('-1;0');
		expect(cleanLevel('')).toBeUndefined();
		expect(levelOk('-1;0')).toBe(true);
		expect(levelOk('')).toBe(true);
		expect(levelOk('sous-sol')).toBe(false);
	});
	it('nouveaux tags : établis, rien d’inventé', () => {
		expect(newPointTags('elevator', { level: '-1;0', wheelchair: 'yes', operator: 'X' })).toEqual({
			highway: 'elevator',
			level: '-1;0',
			wheelchair: 'yes'
		});
		expect(newPointTags('ticket', { operator: ' SNCF Voyageurs ', wheelchair: 'yes' })).toEqual({
			amenity: 'vending_machine',
			vending: 'public_transport_tickets',
			operator: 'SNCF Voyageurs'
		});
	});
	it('correction d’un équipement existant : seulement ce qui change, rien de retiré', () => {
		const cur = { highway: 'elevator', level: '0;-1', wheelchair: 'yes' };
		expect(pointTagChanges('elevator', { level: '0;-1', wheelchair: 'no' }, cur)).toEqual({
			wheelchair: 'no'
		});
		expect(pointTagChanges('elevator', {}, cur)).toEqual({});
	});
});

describe('doublons (moins de 5 m)', () => {
	const [lon, lat] = ll(0, 0);
	const [lon3, lat3] = ll(3, 0);
	const [lon9, lat9] = ll(9, 0);
	const els: OsmElement[] = [
		{ type: 'node', id: 1, lon: lon3, lat: lat3, tags: { highway: 'elevator' } },
		{ type: 'node', id: 2, lon: lon9, lat: lat9, tags: { highway: 'elevator' } },
		{
			type: 'node',
			id: 3,
			lon,
			lat,
			tags: { amenity: 'vending_machine', vending: 'public_transport_tickets' }
		}
	];
	it('même type à 3 m : signalé ; à 9 m ou autre type : non', () => {
		const near = nearbySame('elevator', [lon, lat], els);
		expect(near.map((n) => n.el.id)).toEqual([1]);
		expect(near[0].distM).toBeCloseTo(3, 1);
		expect(nearbySame('ticket', [lon9, lat9], els)).toEqual([]);
	});
});

describe('placement relatif au quai', () => {
	// Quai de 200 × 6 m, axe est-ouest ; voie au nord (y = +5).
	const ring = [ll(-100, 3), ll(100, 3), ll(100, -3), ll(-100, -3), ll(-100, 3)];
	const local = ring.map(([a, b]) => proj.project(a, b));
	const frame = platformFrame([ring]);
	const inside = (lon: number, lat: number) => pointInPolygon(proj.project(lon, lat), local);

	it('longueur, bouts nommés par leur cap', () => {
		expect(frame.lengthM).toBeCloseTo(200, 0);
		const caps = [frame.startBearing, frame.endBearing].map(Math.round).sort((a, b) => a - b);
		expect(caps).toEqual([90, 270]);
	});
	it('chaque choix donne un point dans le contour, du bon côté', () => {
		const north = ll(0, 5);
		const northSide = frame.sideOf(north[0], north[1]);
		for (const along of ['start', 'middle', 'end', 37] as const)
			for (const side of ['left', 'right', 'center'] as const) {
				const p = frame.place(along, side);
				expect(p.inside).toBe(true);
				expect(inside(p.lon, p.lat)).toBe(true);
				const y = proj.project(p.lon, p.lat).y;
				if (side === 'center') expect(Math.abs(y)).toBeLessThan(0.01);
				else if (side === northSide)
					expect(y).toBeCloseTo(2, 1); // à 1 m du bord nord
				else expect(y).toBeCloseTo(-2, 1);
			}
	});
	it('bouts à 8 m du bout ; distance comptée depuis le premier bout, bornée au quai', () => {
		expect(frame.place('start', 'center').alongM).toBeCloseTo(8, 5);
		expect(frame.place('end', 'center').alongM).toBeCloseTo(192, 1);
		expect(frame.place(37, 'center').alongM).toBe(37);
		expect(frame.place(500, 'center').alongM).toBeCloseTo(200, 1);
		const a = frame.place(0, 'center');
		const startPt = proj.project(a.lon, a.lat);
		const startCap = Math.round(frame.startBearing);
		expect(startPt.x).toBeCloseTo(startCap === 270 ? -100 : 100, 0);
	});
	it('quai en plusieurs parties : le point tombe dans la partie qui le contient', () => {
		const a = [ll(-100, 3), ll(0, 3), ll(0, -3), ll(-100, -3), ll(-100, 3)];
		const b = [ll(0, 3), ll(100, 3), ll(100, -3), ll(0, -3), ll(0, 3)];
		const f = platformFrame([a, b]);
		for (const along of [20, 100, 180]) expect(f.place(along, 'left').inside).toBe(true);
	});
	it('quai tracé en ligne : le point est sur la ligne', () => {
		const f = platformFrame([[ll(-50, 0), ll(50, 0)]]);
		const p = f.place('middle', 'left');
		expect(p.inside).toBe(false);
		expect(Math.abs(proj.project(p.lon, p.lat).y)).toBeLessThan(0.01);
	});
});

describe('saisies, envoi', () => {
	const [lon, lat] = ll(0, 0);
	const point: PointEdit = {
		kind: 'point',
		id: 'p1',
		station: 's',
		createdAt: 0,
		tempId: -7,
		lon,
		lat,
		tags: { highway: 'elevator', level: '-1;0', check_date: '2026-11-11' },
		placed: 'platform',
		summary: 'Ascenseur'
	};
	it('nouveau point : nœud isolé créé, rien d’autre', () => {
		const plan = planUpload([point], []);
		expect(plan.create).toEqual([
			{ type: 'node', id: -7, lon, lat, tags: point.tags }
		] as OsmElement[]);
		expect(plan.modify).toEqual([]);
		const xml = osmChangeXml(9, plan);
		expect(xml).toContain('<create><node id="-7" changeset="9"');
		expect(xml).toContain('<tag k="highway" v="elevator"/><tag k="level" v="-1;0"/>');
		expect(applyEdits([], [point])).toHaveLength(1);
		expect(proposedComment('Gare', [point])).toContain('ajouté : Ascenseur');
	});
	it('tags saisis ensuite sur le point pas encore envoyé : rangés dans sa création', () => {
		const tags: TagEdit = {
			kind: 'tags',
			id: 't',
			station: 's',
			createdAt: 1,
			target: 'node/-7',
			tags: { wheelchair: 'yes' },
			summary: 'Ascenseur',
			family: 'equip'
		};
		const r = mergeEdit([point], tags);
		expect(r.edit).toMatchObject({
			kind: 'point',
			tags: { wheelchair: 'yes', highway: 'elevator' }
		});
	});

	const node = { type: 'node', id: 55, version: 2, lon, lat, tags: { highway: 'elevator' } };
	const del: PointDeleteEdit = {
		kind: 'pointdelete',
		id: 'd1',
		station: 's',
		createdAt: 0,
		target: 'node/55',
		version: 2,
		reason: 'duplicate',
		label: 'Ascenseur',
		summary: 'Ascenseur supprimé (en double)'
	};
	it('suppression d’un nœud isolé : supprimé ; relu avant envoi', () => {
		expect(pointsToCheck([del])).toEqual([55]);
		const plan = planUpload([del], [node as OsmElement]);
		expect(plan.conflicts).toEqual([]);
		expect(osmChangeXml(9, plan)).toContain('<delete><node id="55" version="2"');
		expect(applyEdits([node as OsmElement], [del])).toEqual([]);
		expect(proposedComment('Gare', [del])).toContain('Ascenseur supprimé (en double)');
	});
	it('relié entre-temps à un chemin, ou modifié : à revoir, rien n’est supprimé', () => {
		const way = { type: 'way', id: 9, version: 1, nodes: [55, 56], tags: { highway: 'footway' } };
		const linked = planUpload([del], [node, way] as OsmElement[]);
		expect(linked.delete).toEqual([]);
		expect(linked.conflicts).toHaveLength(1);
		const changed = planUpload([del], [{ ...node, version: 3 }] as OsmElement[]);
		expect(changed.conflicts).toHaveLength(1);
	});
	it('les tags d’un équipement marqué à supprimer sont refusés', () => {
		expect(() =>
			mergeEdit([del], {
				kind: 'tags',
				id: 't2',
				station: 's',
				createdAt: 2,
				target: 'node/55',
				tags: { wheelchair: 'no' },
				summary: 'x',
				family: 'equip'
			})
		).toThrow();
	});
});

describe('analyse : équipements de la gare, quête Q9', () => {
	it('ascenseur sans accès fauteuil : Q9 ; distributeur : pas de quête', () => {
		const [a, b] = ll(0, 0);
		const els: OsmElement[] = [
			{ type: 'node', id: 1, lon: a, lat: b, tags: { highway: 'elevator' } },
			{
				type: 'node',
				id: 2,
				lon: a,
				lat: b,
				tags: { amenity: 'vending_machine', vending: 'public_transport_tickets' }
			}
		];
		const [w, s] = ll(-100, -100);
		const [e, n] = ll(100, 100);
		const r = analyzeStation(els, [w, s, e, n]);
		expect(r.points.map((p) => p.kind)).toEqual(['elevator', 'ticket']);
		expect(r.quests.filter((q) => q.id === 'Q9').map((q) => q.target)).toEqual([
			{ type: 'node', id: 1 }
		]);
		// Pas dans les jauges.
		expect(r.completeness.equipment.total).toBe(0);
	});
});
