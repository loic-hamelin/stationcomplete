import { describe, expect, it } from 'vitest';
import { LocalProjection } from './geo';
import type { BBox, OsmElement, Tags } from './osm';
import { analyzeStation } from './quests';

// Petite gare fictive, construite en mètres autour d'un point puis convertie en degrés.
// Voies est-ouest : voie A à y = +4, voie B à y = −4 ; quai central entre les deux (y ∈ [−2, 2]).
const proj = new LocalProjection(5.36, 45.96);
let nextId = 1;
function station(opts: {
	platformTags?: Tags;
	trackA?: Tags;
	trackB?: Tags;
	signs?: { x: number; on: 'A' | 'B'; tags: Tags }[];
	noPlatform?: boolean;
}) {
	nextId = 1;
	const els: OsmElement[] = [];
	const node = (x: number, y: number, tags?: Tags) => {
		const [lon, lat] = proj.unproject({ x, y });
		const id = nextId++;
		els.push({ type: 'node', id, lon, lat, tags });
		return id;
	};
	const way = (nodes: number[], tags: Tags) => {
		const id = 1000 + nextId++;
		els.push({ type: 'way', id, nodes, tags });
		return id;
	};
	const signsOn = (track: 'A' | 'B', y: number) =>
		(opts.signs ?? [])
			.filter((s) => s.on === track)
			.map((s) => ({ x: s.x, id: node(s.x, y, s.tags) }));

	const build = (track: 'A' | 'B', y: number, tags: Tags) => {
		const signs = signsOn(track, y).sort((a, b) => a.x - b.x);
		const nodes = [node(-300, y), ...signs.map((s) => s.id), node(300, y)];
		return way(nodes, { railway: 'rail', ...tags });
	};
	const a = build('A', 4, opts.trackA ?? {});
	const b = build('B', -4, opts.trackB ?? {});
	let p = 0;
	if (!opts.noPlatform) {
		const ring = [node(-100, 2), node(100, 2), node(100, -2), node(-100, -2)];
		p = way([...ring, ring[0]], {
			railway: 'platform',
			public_transport: 'platform',
			...opts.platformTags
		});
	}
	const [w, s] = proj.unproject({ x: -400, y: -300 });
	const [e, n] = proj.unproject({ x: 400, y: 300 });
	return { els, bbox: [w, s, e, n] as BBox, a, b, p };
}

const ids = (qs: { id: string }[]) => qs.map((q) => q.id).sort();
const NOW = new Date('2026-11-05');

describe('analyzeStation', () => {
	it('Q0 : aucune voie à quai si aucun quai', () => {
		const s = station({ noPlatform: true });
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(ids(r.quests)).toEqual(['Q0']);
	});

	it('détecte les deux voies adjacentes au quai central, de chaque côté', () => {
		const s = station({});
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(r.platforms).toHaveLength(1);
		const sides = r.platforms[0].tracks.map((t) => [t.way, t.side]).sort();
		expect(sides).toEqual(
			[
				[s.a, 'left'],
				[s.b, 'right']
			].sort()
		);
		expect(r.platforms[0].lengthM).toBe(200);
	});

	it('quai et voies sans numéro, sans pancarte : Q1, Q2 ×2, Q4 ×2 (et Q8 équipements)', () => {
		const s = station({});
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(ids(r.quests)).toEqual(['Q1', 'Q2', 'Q2', 'Q4', 'Q4', 'Q8']);
		expect(r.completeness).toEqual({
			platforms: { done: 0, total: 1 },
			tracks: { done: 0, total: 2 },
			stopSigns: { done: 0, total: 2 },
			equipment: { done: 0, total: 1 }
		});
		// Équipements : après les numéros et les pancartes, avant les vérifications.
		expect(r.quests.at(-1)?.id).toBe('Q8');
		expect(r.quests.every((q) => q.onSite)).toBe(true);
	});

	it('gare complète et vérifiée récemment : aucune quête', () => {
		const ok = { check_date: '2026-06-01' };
		const sign = (on: 'A' | 'B') => ({
			x: 90,
			on,
			tags: {
				railway: 'signal',
				'railway:signal:stop': 'FR:passenger_stop',
				'railway:signal:direction': 'forward',
				...ok
			}
		});
		const equipped = {
			height: '0.55',
			passenger_information_display: 'yes',
			shelter: 'no',
			tactile_paving: 'yes',
			bench: 'yes'
		};
		const s = station({
			platformTags: { ref: '1;2', ...equipped, ...ok },
			trackA: { 'railway:track_ref': '1', ...ok },
			trackB: { 'railway:track_ref': '2', ...ok },
			signs: [sign('A'), sign('B')]
		});
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(r.quests).toEqual([]);
		expect(r.completeness.stopSigns).toEqual({ done: 2, total: 2 });
		expect(r.completeness.equipment).toEqual({ done: 1, total: 1 });
	});

	it('Q3 : le ref du quai ne correspond pas aux numéros des voies', () => {
		const s = station({
			platformTags: { ref: 'A', check_date: '2026-01-01' },
			trackA: { 'railway:track_ref': '1', check_date: '2026-01-01' },
			trackB: { 'railway:track_ref': '2', check_date: '2026-01-01' }
		});
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(ids(r.quests).filter((q) => q === 'Q3')).toEqual(['Q3']);
	});

	it('Q5 : pancarte à l’ancien format ou sans sens ; Q6 pour les objets non vérifiés', () => {
		const s = station({
			platformTags: { ref: '1;2' },
			trackA: { 'railway:track_ref': '1' },
			trackB: { 'railway:track_ref': '2' },
			signs: [
				{ x: 0, on: 'A', tags: { railway: 'signal', 'railway:signal:stop': 'FR:ARRET_TT' } },
				{ x: 10, on: 'B', tags: { railway: 'signal', 'railway:signal:stop': 'FR:passenger_stop' } }
			]
		});
		const r = analyzeStation(s.els, s.bbox, NOW);
		const q5 = r.quests
			.filter((q) => q.id === 'Q5')
			.map((q) => q.details?.motif)
			.sort();
		expect(q5).toEqual(['ancien format', 'sens manquant']);
		// quai + 2 voies + la pancarte au nouveau format (l'ancienne relève de Q5)
		expect(r.quests.filter((q) => q.id === 'Q6')).toHaveLength(4);
		expect(r.quests.find((q) => q.id === 'Q6')?.onSite).toBe(false);
	});

	it('Q7 : « Voie 1 » dans le nom d’une voie', () => {
		const s = station({ trackA: { name: 'Voie 1' } });
		const r = analyzeStation(s.els, s.bbox, NOW);
		expect(r.quests[0]).toMatchObject({ id: 'Q7', details: { motif: 'numéro mal placé' } });
	});
});
