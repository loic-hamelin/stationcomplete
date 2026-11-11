// Quai en plusieurs parties (quai logique) : regroupement, quêtes, carte, saisie et envoi.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyEdits, mergeEdit, type Edit, type TagEdit } from './edits';
import { buildFeatures } from './features';
import { LocalProjection, type Pt } from './geo';
import type { BBox, OsmElement, OsmWay, Tags } from './osm';
import { railChains } from './platformGroups';
import { THRESHOLDS, analyzeStation } from './quests';
import { elementsToFetch, osmChangeXml, planUpload, proposedComment } from './upload';

// Gare fictive en mètres : voie A à y = +6, voie B à y = −6 (axe est-ouest), coupées en x = 0
// (tunnel à l'ouest) ; quai central (y ∈ [−4, 4]) en parties le long de x.
const proj = new LocalProjection(2.3266, 48.8772);
const NOW = new Date('2026-11-11');
const P = (x: number, y: number) => proj.unproject({ x, y });

function build(
	spec: {
		parts?: { x0: number; x1: number; y0?: number; y1?: number; tags?: Tags; turn?: number }[];
		/** Coupe des voies (x) ; null : voies d'un seul tenant. */
		cut?: number | null;
		trackA?: Tags;
		trackB?: Tags;
		tunnelA?: Tags;
		/** Voies supplémentaires (y), d'un seul tenant. */
		more?: number[];
		/** Aucune voie : seule la géométrie des parties décide. */
		noTracks?: boolean;
	} = {}
) {
	let id = 1;
	const els: OsmElement[] = [];
	const at = new Map<string, number>();
	// Nœuds réutilisés à la même position : les parties qui se touchent partagent leurs nœuds.
	const node = (p: Pt) => {
		const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
		if (at.has(k)) return at.get(k)!;
		const [lon, lat] = P(p.x, p.y);
		const n = id++;
		els.push({ type: 'node', id: n, lon, lat, version: 1 });
		at.set(k, n);
		return n;
	};
	const way = (nodes: number[], tags: Tags) => {
		const w = 1000 + id++;
		els.push({ type: 'way', id: w, nodes, tags, version: 2 });
		return w;
	};
	const rail = (y: number, tags: Tags, tunnel?: Tags) => {
		const cut = spec.cut === undefined ? 0 : spec.cut;
		if (cut === null)
			return [way([node({ x: -300, y }), node({ x: 300, y })], { railway: 'rail', ...tags })];
		return [
			way([node({ x: -300, y }), node({ x: cut, y })], {
				railway: 'rail',
				tunnel: 'yes',
				layer: '-1',
				...(tunnel ?? tags)
			}),
			way([node({ x: cut, y }), node({ x: 300, y })], { railway: 'rail', ...tags })
		];
	};
	const a = spec.noTracks ? [] : rail(6, spec.trackA ?? {}, spec.tunnelA);
	const b = spec.noTracks ? [] : rail(-6, spec.trackB ?? {});
	for (const y of spec.more ?? []) rail(y, {});
	const parts = (spec.parts ?? []).map((p) => {
		const y0 = p.y0 ?? -4,
			y1 = p.y1 ?? 4;
		// Rotation éventuelle (degrés) autour du milieu du bord x0 : partie qui « tourne ».
		const r = ((p.turn ?? 0) * Math.PI) / 180;
		const ym = (y0 + y1) / 2;
		const rot = (q: Pt): Pt =>
			r
				? {
						x: p.x0 + (q.x - p.x0) * Math.cos(r) - (q.y - ym) * Math.sin(r),
						y: ym + (q.x - p.x0) * Math.sin(r) + (q.y - ym) * Math.cos(r)
					}
				: q;
		const ring = [
			{ x: p.x0, y: y0 },
			{ x: p.x1, y: y0 },
			{ x: p.x1, y: y1 },
			{ x: p.x0, y: y1 }
		].map((q) => node(rot(q)));
		return way([...ring, ring[0]], {
			railway: 'platform',
			public_transport: 'platform',
			...p.tags
		});
	});
	const [w, s] = P(-400, -300);
	const [e, n] = P(400, 300);
	const bbox = [w, s, e, n] as BBox;
	return { els, bbox, a, b, parts, analysis: () => analyzeStation(els, bbox, NOW, 'fr') };
}

const covered = { layer: '-1', covered: 'yes' };

describe('quai logique : regroupement', () => {
	it('parties contiguës alignées, nœuds partagés, le long des mêmes voies → un seul quai', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: 0, tags: covered }
			]
		});
		const a = g.analysis();
		expect(a.platforms).toHaveLength(1);
		const p = a.platforms[0];
		expect(p.ref).toEqual({ type: 'way', id: g.parts[0] });
		expect(p.parts?.map((x) => [x.ref.id, x.lengthM, x.covered])).toEqual([
			[g.parts[0], 120, false],
			[g.parts[1], 60, true]
		]);
		expect(p.lengthM).toBe(180);
		// Voies du quai entier : les deux tronçons de chaque voie, des deux côtés.
		expect(p.tracks.map((t) => t.way).sort()).toEqual([...g.a, ...g.b].sort());
		expect(new Set(p.tracks.map((t) => t.side)).size).toBe(2);
	});

	it('quêtes et jauges comptées une fois pour le quai entier', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: -0.8, tags: covered },
				{ x0: -110, x1: -60, tags: { ...covered, location: 'underground' } }
			]
		});
		const a = g.analysis();
		expect(a.platforms).toHaveLength(1);
		expect(a.platforms[0].parts).toHaveLength(3);
		const count = (id: string) => a.quests.filter((q) => q.id === id).length;
		expect(count('Q1')).toBe(1);
		expect(count('Q4')).toBe(2); // un par côté du quai, pas un par partie
		expect(a.completeness.platforms).toEqual({ done: 0, total: 1 });
		expect(a.completeness.stopSigns.total).toBe(2);
	});

	it('bords à 0,8 m sans nœud partagé → regroupées ; à 1,5 m → non', () => {
		const near = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: -0.8, tags: covered }
			]
		});
		expect(near.analysis().platforms).toHaveLength(1);
		const far = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: -1.5, tags: covered }
			]
		});
		expect(far.analysis().platforms).toHaveLength(2);
	});

	it('axes à 30° → deux quais ; à 10° → un seul', () => {
		const turned = (deg: number) =>
			build({
				noTracks: true,
				parts: [
					{ x0: 0, x1: 120 },
					// Partie qui tourne autour de l'angle commun (−60…0 ramené par la rotation).
					{ x0: 0, x1: -60, turn: deg, tags: covered }
				]
			}).analysis().platforms.length;
		expect(turned(30)).toBe(2);
		expect(turned(10)).toBe(1);
	});

	it('quais parallèles côte à côte (même longueur, bord commun) → jamais regroupés', () => {
		const g = build({
			cut: null,
			parts: [
				{ x0: -100, x1: 100, y0: 0, y1: 4 },
				{ x0: -100, x1: 100, y0: -4, y1: 0 }
			]
		});
		expect(g.analysis().platforms).toHaveLength(2);
	});

	it('même nom et contact (« Voie 27 », parties qui se chevauchent) → un seul quai', () => {
		// Paris-Saint-Lazare : parties découpées à la main, qui se recouvrent sur leur longueur.
		const name = { name: 'Voie 27' };
		const g = build({
			cut: null,
			parts: [
				{ x0: -100, x1: 100, y0: 0, y1: 4, tags: name },
				{ x0: -100, x1: 100, y0: -4, y1: 0, tags: { ...name, ...covered } }
			]
		});
		expect(g.analysis().platforms).toHaveLength(1);
	});

	it('même nom mais de part et d’autre d’une voie → deux quais', () => {
		const name = { name: 'Voie 27' };
		const g = build({
			cut: null,
			parts: [
				{ x0: -100, x1: 0, y0: 1, y1: 5, tags: name },
				{ x0: 0, x1: 100, y0: 7, y1: 11, tags: name }
			]
		});
		expect(g.analysis().platforms).toHaveLength(2);
	});

	it('quais de part et d’autre d’une voie → jamais regroupés, même avec des seuils relâchés', async () => {
		const { groupPlatforms } = await import('./platformGroups');
		// Deux quais bout à bout en quinconce, la voie A (y = 6) entre les deux.
		const g = build({
			cut: null,
			parts: [
				{ x0: -100, x1: 0, y0: 1, y1: 5 },
				{ x0: 0, x1: 100, y0: 7, y1: 11 }
			]
		});
		expect(g.analysis().platforms).toHaveLength(2);
		// Seuils relâchés (contact, décalage) : la règle des voies suffit à refuser.
		const loose = { ...THRESHOLDS, groupTouchM: 5, groupMaxLateralM: 50 };
		const data = g.els;
		const ways = data.filter((e): e is OsmWay => e.type === 'way');
		const nodes = new Map(
			data.filter((e) => e.type === 'node').map((n) => [n.id, n as { lon: number; lat: number }])
		);
		const pts = (w: OsmWay) =>
			w.nodes.map((i) => proj.project(nodes.get(i)!.lon, nodes.get(i)!.lat));
		const { platformTracks } = await import('./quests');
		const rails = ways
			.filter((w) => w.tags?.railway === 'rail')
			.map((w) => ({ id: w.id, nodes: w.nodes, pts: pts(w) }));
		const parts = ways
			.filter((w) => w.tags?.railway === 'platform')
			.map((w) => {
				const { axis, tracks } = platformTracks([pts(w)], true, rails);
				return { nodes: w.nodes, contour: [pts(w)], tags: w.tags ?? {}, axis, tracks };
			});
		expect(parts[0].tracks.find((t) => t.way === g.a[0])?.side).not.toBe(
			parts[1].tracks.find((t) => t.way === g.a[0])?.side
		);
		expect(groupPlatforms(parts, rails, loose)).toHaveLength(2);
	});

	it('deux lettres différentes (local_ref A et B) bout à bout → deux quais', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120, tags: { local_ref: 'A' } },
				{ x0: -60, x1: 0, tags: { local_ref: 'B' } }
			]
		});
		expect(g.analysis().platforms).toHaveLength(2);
	});

	it('voies coupées : sans regroupement des tronçons, les parties ne longeraient pas les mêmes voies', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: 0, tags: covered }
			]
		});
		const a = g.analysis();
		expect(a.platforms).toHaveLength(1);
		// Tronçons de la voie A : même voie continue (tunnel sans numéro, puis numérotée).
		const g2 = build({
			parts: [{ x0: 0, x1: 120 }],
			trackA: { 'railway:track_ref': '3' },
			tunnelA: {}
		});
		const ways = g2.els.filter((e): e is OsmWay => e.type === 'way' && e.tags?.railway === 'rail');
		const rails = ways.map((w) => ({
			id: w.id,
			nodes: w.nodes,
			pts: w.nodes.map(() => ({ x: 0, y: 0 })),
			trackRef: w.tags?.['railway:track_ref']
		}));
		// (Directions réelles : tronçons est-ouest.)
		rails.forEach((r, i) => {
			const [x0, x1] = i % 2 ? [0, 300] : [-300, 0];
			r.pts = [
				{ x: x0, y: 0 },
				{ x: x1, y: 0 }
			];
		});
		const chains = railChains(rails, THRESHOLDS);
		expect(chains.get(g2.a[0])).toBe(chains.get(g2.a[1]));
		expect(chains.get(g2.a[0])).not.toBe(chains.get(g2.b[0]));
	});

	it('voies : numéros différents jamais réunis ; aiguillage (3 tronçons) sans numéro non plus', () => {
		const line = (id: number, nodes: number[], pts: Pt[], trackRef?: string) => ({
			id,
			nodes,
			pts,
			trackRef
		});
		const W = { x: -100, y: 0 },
			O = { x: 0, y: 0 },
			E = { x: 100, y: 0 },
			NE = { x: 100, y: 10 };
		expect(
			new Set(
				railChains(
					[line(1, [1, 2], [W, O], '3'), line(2, [2, 3], [O, E], '4')],
					THRESHOLDS
				).values()
			).size
		).toBe(2);
		const sw = railChains(
			[line(1, [1, 2], [W, O]), line(2, [2, 3], [O, E]), line(3, [2, 4], [O, NE])],
			THRESHOLDS
		);
		expect(new Set(sw.values()).size).toBe(3);
		// Même numéro de part et d'autre de l'aiguillage : la voie 3 continue.
		const same = railChains(
			[line(1, [1, 2], [W, O], '3'), line(2, [2, 3], [O, E], '3'), line(3, [2, 4], [O, NE])],
			THRESHOLDS
		);
		expect(same.get(1)).toBe(same.get(2));
		expect(same.get(3)).not.toBe(same.get(1));
	});

	it('partie principale : la plus longue à l’air libre, même si une partie couverte est plus longue', () => {
		const g = build({
			parts: [
				{ x0: -150, x1: 0, tags: covered },
				{ x0: 0, x1: 80 }
			]
		});
		const p = g.analysis().platforms[0];
		expect(p.ref.id).toBe(g.parts[1]);
		expect(p.parts?.[0].covered).toBe(false);
	});
});

describe('quai logique : numéros', () => {
	it('numéros différents d’une partie à l’autre → incohérent (Q3 « parties »), sans correction', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120, tags: { ref: '3' } },
				{ x0: -60, x1: 0, tags: { ...covered, ref: '3;4' } }
			]
		});
		const a = g.analysis();
		const p = a.platforms[0];
		expect(p.mixed).toEqual({ ref: ['3', '3;4'] });
		expect(p.tags.ref).toBe('3');
		const q3 = a.quests.filter((q) => q.id === 'Q3');
		expect(q3).toHaveLength(1);
		expect(q3[0].details?.motif).toBe('parties');
		expect(a.completeness.platforms).toEqual({ done: 1, total: 1 });
		// Même valeur écrite autrement (« 4;3 » et « 3;4 ») : cohérent.
		const same = build({
			parts: [
				{ x0: 0, x1: 120, tags: { ref: '4;3' } },
				{ x0: -60, x1: 0, tags: { ...covered, ref: '3;4' } }
			]
		}).analysis();
		expect(same.platforms[0].mixed).toBeUndefined();
	});

	it('une partie sans numéro : le quai porte le numéro de l’autre, Q1 « à reporter »', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120, tags: { ref: '3' } },
				{ x0: -60, x1: 0, tags: covered }
			]
		});
		const a = g.analysis();
		expect(a.platforms[0].tags.ref).toBe('3');
		expect(a.platforms[0].missingRef).toBe(1);
		expect(a.quests.filter((q) => q.id === 'Q1').map((q) => q.details?.parties)).toEqual([1]);
		expect(a.completeness.platforms).toEqual({ done: 0, total: 1 });
	});
});

describe('quai logique : carte', () => {
	it('un objet par partie, une seule étiquette (sur la partie principale), même `osm`', () => {
		const g = build({
			parts: [
				{ x0: 0, x1: 120 },
				{ x0: -60, x1: 0, tags: covered }
			]
		});
		const a = g.analysis();
		const f = buildFeatures(g.els, a, g.bbox).features.filter((x) => x.properties.kind === 'quai');
		expect(f).toHaveLength(2);
		expect(f.map((x) => x.properties.osm)).toEqual([`way/${g.parts[0]}`, `way/${g.parts[0]}`]);
		expect(f.map((x) => x.properties.part)).toEqual([`way/${g.parts[0]}`, `way/${g.parts[1]}`]);
		expect(f.map((x) => x.properties.label)).toEqual(['?', '']);
		expect(f.map((x) => !!x.properties.under)).toEqual([false, true]);
		expect(f[0].properties.title).toBe('Quai sans numéro — en 2 parties, dont 1 couverte');
	});
});

// ---------- Saisie et envoi ----------

const fixture = JSON.parse(readFileSync('tests/fixtures/saint-lazare-type.json', 'utf8')) as {
	station: { bbox: BBox };
	parts: { P: number[]; Q: number[] };
	elements: OsmElement[];
};

function groupEdit(over: Partial<TagEdit> = {}): TagEdit {
	const [main, ...others] = fixture.parts.P;
	return {
		kind: 'tags',
		id: 'g1',
		station: 'n3533789791',
		createdAt: 0,
		target: `way/${main}`,
		version: 3,
		base: { ref: null },
		tags: { ref: '23', check_date: '2026-11-11' },
		parts: others.map((id) => ({ target: `way/${id}` as const, version: 3, base: { ref: null } })),
		name: 'Quai voies 23',
		summary: 'Quai : voies 23 (3 parties)',
		family: 'quai',
		...over
	};
}

describe('quai logique : saisie sur toutes les parties', () => {
	it('fixture « type Saint-Lazare » : 2 quais (3 et 2 parties), aucune partie comptée à part', () => {
		const a = analyzeStation(fixture.elements, fixture.station.bbox, NOW, 'fr');
		expect(a.platforms).toHaveLength(2);
		const [p, q] = a.platforms;
		expect(p.parts?.map((x) => x.ref.id)).toEqual(fixture.parts.P);
		expect(p.parts?.filter((x) => x.covered)).toHaveLength(2);
		expect(q.parts?.map((x) => x.ref.id)).toEqual(fixture.parts.Q);
		expect(q.mixed?.ref).toEqual(['25;26', '26']);
		expect(a.completeness.platforms.total).toBe(2);
	});

	it('la saisie écrit les mêmes numéros sur toutes les parties : un <modify> par way', () => {
		const ed = groupEdit();
		const local = applyEdits(fixture.elements, [ed]);
		for (const id of fixture.parts.P)
			expect(local.find((e) => e.type === 'way' && e.id === id)?.tags?.ref).toBe('23');
		const a = analyzeStation(local, fixture.station.bbox, NOW, 'fr');
		expect(a.platforms[0].tags.ref).toBe('23');
		expect(a.platforms[0].missingRef).toBeUndefined();

		expect(elementsToFetch([ed]).ways.sort()).toEqual([...fixture.parts.P].sort());
		const plan = planUpload([ed], fixture.elements);
		expect(plan.sent).toEqual(['g1']);
		expect(plan.touched.g1).toEqual(fixture.parts.P.map((id) => `way/${id}`));
		const xml = osmChangeXml(7, plan);
		const modified = [...xml.matchAll(/<way id="(\d+)" version="3" changeset="7">.*?<\/way>/g)];
		expect(modified.map((m) => Number(m[1]))).toEqual(fixture.parts.P);
		for (const m of modified) expect(m[0]).toContain('<tag k="ref" v="23"/>');
		expect(proposedComment('Paris-Saint-Lazare', [ed])).toBe(
			'Gare de Paris-Saint-Lazare : Quai voies 23 (3 parties) : numéro renseigné sur chaque partie'
		);
	});

	it('une partie changée entre-temps : toute la saisie passe « à revoir »', () => {
		const ed = groupEdit();
		const changed = fixture.elements.map((e) =>
			e.type === 'way' && e.id === fixture.parts.P[2]
				? { ...e, version: 4, tags: { ...e.tags, ref: '24' } }
				: e
		);
		const plan = planUpload([ed], changed);
		expect(plan.sent).toEqual([]);
		expect(plan.modify).toEqual([]);
		expect(plan.conflicts[0].reason).toContain('Une partie du quai');
		// Partie supprimée entre-temps : idem.
		const gone = fixture.elements.filter((e) => !(e.type === 'way' && e.id === fixture.parts.P[1]));
		expect(planUpload([ed], gone).conflicts).toHaveLength(1);
	});

	it('fusion : une nouvelle saisie sur le quai garde ses parties ; une forme ne l’absorbe pas', () => {
		const first = groupEdit();
		const again = groupEdit({
			id: 'g2',
			tags: { check_date: '2026-11-12' },
			parts: first.parts!.map((p) => ({ target: p.target, version: 9, base: {} }))
		});
		const m = mergeEdit([first], again).edit as TagEdit;
		expect(m.id).toBe('g1');
		expect(m.parts?.map((p) => [p.target, p.version])).toEqual(
			first.parts!.map((p) => [p.target, 3])
		);
		const shape = {
			kind: 'shape',
			id: 's1',
			station: 'n3533789791',
			createdAt: 1,
			target: first.target,
			mode: 'reshape',
			before: [],
			nodes: [],
			name: 'Quai',
			shapeSummary: 'Forme',
			summary: 'Forme'
		} as unknown as Edit;
		expect(mergeEdit([first], shape).drop).toEqual([]);
	});
});
