// Contrôles avant envoi (QA-2) : une règle par bloc, cas qui déclenche et cas qui ne déclenche pas
// (à la manière des assertMatch / assertNoMatch des règles MapCSS d'OpenRailwayMap et de JOSM).
import { describe, expect, it } from 'vitest';
import { LocalProjection } from './geo';
import type { BBox, OsmElement, Tags } from './osm';
import type {
	Edit,
	NewNodeEdit,
	NewWayEdit,
	PointEdit,
	ShapeEdit,
	TagEdit,
	PointDeleteEdit
} from './edits';
import { heldBack, suggestReview, validateEdits, verifiedWarnings, type Issue } from './validate';

// Petite gare en mètres : voie A (way 100) à y = +4, voie B (way 101) à y = −4, quai central
// (way 200) entre les deux, y ∈ [−2, 2], x ∈ [−100, 100]. Une voie C (way 102) à y = 30.
const proj = new LocalProjection(5.36, 45.96);
const ll = (x: number, y: number) => proj.unproject({ x, y });
function base(o: { platform?: Tags; a?: Tags; b?: Tags; c?: Tags } = {}): OsmElement[] {
	const els: OsmElement[] = [];
	const n = (id: number, x: number, y: number, tags?: Tags) => {
		const [lon, lat] = ll(x, y);
		els.push({ type: 'node', id, lon, lat, version: 1, ...(tags ? { tags } : {}) });
	};
	n(1, -300, 4);
	n(2, 0, 4);
	n(3, 300, 4);
	n(4, -300, -4);
	n(5, 300, -4);
	n(6, -300, 30);
	n(7, 300, 30);
	n(11, -100, 2);
	n(12, 100, 2);
	n(13, 100, -2);
	n(14, -100, -2);
	els.push(
		{ type: 'way', id: 100, nodes: [1, 2, 3], version: 1, tags: { railway: 'rail', ...o.a } },
		{ type: 'way', id: 101, nodes: [4, 5], version: 1, tags: { railway: 'rail', ...o.b } },
		{ type: 'way', id: 102, nodes: [6, 7], version: 1, tags: { railway: 'rail', ...o.c } },
		{
			type: 'way',
			id: 200,
			nodes: [11, 12, 13, 14, 11],
			version: 1,
			tags: { railway: 'platform', public_transport: 'platform', ...o.platform }
		}
	);
	return els;
}
const [w0, s0] = ll(-400, -100);
const [e0, n0] = ll(400, 100);
const BBOX: BBox = [w0, s0, e0, n0];

const common = { station: 'w1', createdAt: 0, summary: 's' };
const tagEdit = (target: TagEdit['target'], tags: Record<string, string | null>, id = 't1') =>
	({ ...common, id, kind: 'tags', target, tags }) as TagEdit;
const check = (els: OsmElement[], edits: Edit[]) => validateEdits(els, edits, edits, BBOX, 'fr');
const rules = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.rule}`);

describe('forme du quai (checkShape) et croisement des voies', () => {
	const drawn = (pts: [number, number][], id = 'd1'): NewWayEdit => ({
		...common,
		id,
		kind: 'way',
		tempId: -1,
		nodes: pts.map(([x, y], i) => {
			const [lon, lat] = ll(x, y);
			return { id: -10 - i, lon, lat };
		}),
		tags: { railway: 'platform', public_transport: 'platform', train: 'yes' }
	});
	it('quai dessiné le long de la voie C : rien', () => {
		expect(
			check(base(), [
				drawn([
					[-50, 26],
					[50, 26],
					[50, 21],
					[-50, 21]
				])
			])
		).toEqual([]);
	});
	it('côtés qui se croisent, trop petit : erreur « shape »', () => {
		expect(
			rules(
				check(base(), [
					drawn([
						[-50, 26],
						[50, 21],
						[50, 26],
						[-50, 21]
					])
				])
			)
		).toContain('error:shape');
		const small = check(base(), [
			drawn([
				[0, 20],
				[5, 20],
				[5, 18]
			])
		]);
		expect(small.map((i) => i.message).join()).toMatch(/trop court/);
	});
	it('quai qui croise la voie C : erreur', () => {
		expect(
			rules(
				check(base(), [
					drawn([
						[-50, 33],
						[50, 33],
						[50, 25],
						[-50, 25]
					])
				])
			)
		).toContain('error:trackCrossing');
	});
	it('voie en tunnel sous un quai en surface : pas de croisement', () => {
		expect(
			rules(
				check(base({ c: { tunnel: 'yes', layer: '-1' } }), [
					drawn([
						[-50, 33],
						[50, 33],
						[50, 25],
						[-50, 25]
					])
				])
			)
		).not.toContain('error:trackCrossing');
	});
});

describe('nœud en double', () => {
	const shape = (moveTo: [number, number]): ShapeEdit => {
		const [lon, lat] = ll(...moveTo);
		const orig = base().filter((e) => e.type === 'node' && e.id >= 11) as {
			id: number;
			lon: number;
			lat: number;
		}[];
		const before = orig.map((n) => ({ id: n.id, lon: n.lon, lat: n.lat, locked: false }));
		return {
			...common,
			id: 's1',
			kind: 'shape',
			target: 'way/200',
			mode: 'reshape',
			before,
			nodes: before.map((n) => (n.id === 12 ? { id: 12, lon, lat } : n)),
			name: 'Quai',
			shapeSummary: 'forme'
		};
	};
	it('point déplacé à 2 cm d’un autre point du quai : erreur', () => {
		expect(rules(check(base(), [shape([100.0, -1.98])]))).toContain('error:duplicateNode');
	});
	it('point déplacé ailleurs : rien', () => {
		expect(rules(check(base(), [shape([110, 2])]))).not.toContain('error:duplicateNode');
	});
});

describe('pancarte d’arrêt', () => {
	const sign = (tags: Tags, way = 100): NewNodeEdit => {
		const [lon, lat] = ll(50, 4);
		return { ...common, id: 'n1', kind: 'node', tempId: -5, lon, lat, way, after: 1, tags };
	};
	const ok = {
		railway: 'signal',
		'railway:signal:stop': 'FR:passenger_stop',
		'railway:signal:direction': 'forward',
		'railway:signal:position': 'right'
	};
	it('posée sur la voie, avec un sens : rien', () => {
		expect(check(base(), [sign(ok)])).toEqual([]);
	});
	it('sens manquant : erreur', () => {
		const { 'railway:signal:direction': _, ...noDir } = ok;
		void _;
		expect(rules(check(base(), [sign(noDir)]))).toContain('error:signDirection');
	});
	it('voie disparue (hors d’une voie) : erreur', () => {
		expect(rules(check(base(), [sign(ok, 999)]))).toContain('error:signOffTrack');
	});
	it('posée sur un way qui n’est pas une voie : erreur', () => {
		expect(rules(check(base(), [sign(ok, 200)]))).toContain('error:signOffTrack');
	});
	it('sens inconnu (valeur hors liste) : erreur de valeur', () => {
		expect(rules(check(base(), [sign({ ...ok, 'railway:signal:direction': 'up' })]))).toContain(
			'error:tagValue'
		);
	});
});

describe('valeurs des tags écrits par l’appli', () => {
	it('hauteur : 0.55 rien ; 0.15 et 1.8 à vérifier ; « haut » erreur', () => {
		expect(check(base(), [tagEdit('way/200', { height: '0.55' })])).toEqual([]);
		expect(rules(check(base(), [tagEdit('way/200', { height: '0.15' })]))).toEqual([
			'warning:height'
		]);
		expect(rules(check(base(), [tagEdit('way/200', { height: '1.8' })]))).toEqual([
			'warning:height'
		]);
		expect(rules(check(base(), [tagEdit('way/200', { height: 'haut' })]))).toEqual([
			'error:tagValue'
		]);
	});
	it('incline, conveying, oui/non, nombre de marches, niveau, date', () => {
		const bad = (tags: Record<string, string>) => rules(check(base(), [tagEdit('way/102', tags)]));
		expect(bad({ incline: 'up', conveying: 'forward', handrail: 'yes' })).toEqual([]);
		expect(bad({ incline: 'upward' })).toEqual(['error:tagValue']);
		expect(bad({ conveying: 'sideways' })).toEqual(['error:tagValue']);
		expect(bad({ shelter: 'oui' })).toEqual(['error:tagValue']);
		expect(bad({ step_count: '0' })).toEqual(['error:tagValue']);
		expect(bad({ level: '-1;0', check_date: '2026-11-13' })).toEqual([]);
		expect(bad({ level: 'sous-sol' })).toEqual(['error:tagValue']);
		expect(bad({ check_date: '13/11/2026' })).toEqual(['error:tagValue']);
	});
	it('retirer un tag (null) n’est jamais une valeur fautive', () => {
		expect(check(base(), [tagEdit('way/200', { height: null })])).toEqual([]);
	});
	it('numéros : mots, espaces et doublons autour de « ; » (Osmose 3060, 9015009)', () => {
		const r = (tags: Record<string, string>, target: TagEdit['target'] = 'way/200') =>
			rules(check(base(), [tagEdit(target, tags)]));
		expect(r({ ref: 'Voie 1' })).toEqual(['error:refWord']);
		expect(r({ ref: '1 ; 2' })).toEqual(['error:refFormat']);
		expect(r({ ref: '1;1' })).toEqual(['error:refFormat']);
		expect(r({ local_ref: 'A;' })).toEqual(['error:refFormat']);
		expect(r({ 'railway:track_ref': '5' }, 'way/102')).toEqual([]);
	});
	it('railway:track_ref posé ailleurs que sur une voie : erreur (Osmose 9015008)', () => {
		expect(rules(check(base(), [tagEdit('way/200', { 'railway:track_ref': '1' })]))).toContain(
			'error:trackRefPlace'
		);
	});
});

describe('numéros de voie et de quai (règles de l’appli, avertissements)', () => {
	it('deux voies voisines avec le même numéro dans la gare : à vérifier', () => {
		const els = base({ a: { 'railway:track_ref': '1' } });
		expect(rules(check(els, [tagEdit('way/101', { 'railway:track_ref': '1' })]))).toContain(
			'warning:duplicateTrackRef'
		);
		expect(rules(check(els, [tagEdit('way/101', { 'railway:track_ref': '2' })]))).not.toContain(
			'warning:duplicateTrackRef'
		);
	});
	it('numéro de quai différent des voies qu’il longe : à vérifier', () => {
		const els = base({ a: { 'railway:track_ref': '1' }, b: { 'railway:track_ref': '2' } });
		expect(rules(check(els, [tagEdit('way/200', { ref: '1;3' })]))).toEqual([
			'warning:platformRef'
		]);
		expect(check(els, [tagEdit('way/200', { ref: '1;2' })])).toEqual([]);
	});
	it('le numéro d’une voie rend incohérent le quai qu’elle longe : à vérifier', () => {
		const els = base({ platform: { ref: '1;2' }, a: { 'railway:track_ref': '1' } });
		expect(rules(check(els, [tagEdit('way/101', { 'railway:track_ref': '4' })]))).toContain(
			'warning:platformRef'
		);
	});
	it('quai déjà incohérent dans OSM, numéro d’une voie qui le longe : rien (quête Q3)', () => {
		const els = base({
			platform: { ref: '7' },
			a: { 'railway:track_ref': '1' },
			b: { 'railway:track_ref': '2' }
		});
		expect(check(els, [tagEdit('way/101', { 'railway:track_ref': '3' })])).toEqual([]);
	});
	it('incohérence déjà dans OSM, saisie sans rapport : rien', () => {
		const els = base({
			platform: { ref: '7' },
			a: { 'railway:track_ref': '1' },
			b: { 'railway:track_ref': '2' }
		});
		expect(check(els, [tagEdit('way/102', { 'railway:track_ref': '9' })])).toEqual([]);
	});
});

describe('équipement en double', () => {
	const point = (x: number, id = 'p1'): PointEdit => {
		const [lon, lat] = ll(x, 10);
		return {
			...common,
			id,
			kind: 'point',
			tempId: -7,
			lon,
			lat,
			placed: 'photo',
			tags: { highway: 'elevator' }
		};
	};
	it('ascenseur à 3 m d’un autre : à vérifier ; à 20 m : rien', () => {
		const els = [...base()];
		const [lon, lat] = ll(0, 10);
		els.push({ type: 'node', id: 50, lon, lat, tags: { highway: 'elevator' } });
		expect(rules(check(els, [point(3)]))).toEqual(['warning:duplicateEquipment']);
		expect(check(els, [point(20)])).toEqual([]);
	});
});

describe('saisies retenues', () => {
	it('erreur : retenue ; avertissement : retenu tant qu’il n’est pas vérifié', () => {
		const els = base();
		const e1 = tagEdit('way/200', { height: '1.8' }, 'a');
		const e2 = tagEdit('way/102', { incline: 'nord' }, 'b');
		const issues = validateEdits(els, [e1, e2], [e1, e2], BBOX, 'fr');
		expect([...heldBack([e1, e2], issues)].sort()).toEqual(['a', 'b']);
		const v1 = { ...e1, verified: [issues.find((i) => i.edit === 'a')!.key] };
		expect([...heldBack([v1, e2], issues)]).toEqual(['b']);
		expect(verifiedWarnings([v1, e2], issues).map((e) => e.id)).toEqual(['a']);
	});
	it('seules les saisies à envoyer sont contrôlées (les autres servent à la vue)', () => {
		const els = base();
		const other = tagEdit('way/102', { incline: 'nord' }, 'x');
		const mine = tagEdit('way/200', { height: '0.55' }, 'y');
		expect(validateEdits(els, [other, mine], [mine], BBOX, 'fr')).toEqual([]);
	});
});

describe('relecture cochée d’office (QA-3)', () => {
	const shapeMoving = (shared: boolean): ShapeEdit => {
		const [lon, lat] = ll(0, 0);
		return {
			...common,
			id: 'sh',
			kind: 'shape',
			target: 'way/200',
			mode: 'reshape',
			before: [{ id: 11, lon: 1, lat: 1, locked: false, shared }],
			nodes: [{ id: 11, lon, lat }],
			name: 'Quai',
			shapeSummary: 'forme'
		};
	};
	const del: PointDeleteEdit = {
		...common,
		id: 'pd',
		kind: 'pointdelete',
		target: 'node/9',
		reason: 'duplicate',
		label: 'Ascenseur'
	};
	it('suppression, point partagé déplacé, déclaration sur l’honneur : cochée', () => {
		expect(suggestReview([del])).toBe(true);
		expect(suggestReview([shapeMoving(true)])).toBe(true);
		expect(suggestReview([{ ...tagEdit('way/200', { ref: '1' }), onsite: 'declaration' }])).toBe(
			true
		);
	});
	it('point non partagé déplacé, GPS (même à l’entrée), simple numéro : décochée', () => {
		expect(suggestReview([shapeMoving(false)])).toBe(false);
		expect(suggestReview([{ ...tagEdit('way/200', { ref: '1' }), onsite: 'gps-entree' }])).toBe(
			false
		);
		expect(suggestReview([tagEdit('way/102', { 'railway:track_ref': '3' })])).toBe(false);
	});
	it('avertissement vérifié : cochée ; non vérifié (la saisie ne part pas) : sans effet', () => {
		const e = tagEdit('way/200', { height: '1.8' }, 'h');
		const issues = check(base(), [e]);
		expect(suggestReview([e], issues)).toBe(false);
		expect(suggestReview([{ ...e, verified: [issues[0].key] }], issues)).toBe(true);
	});
});
