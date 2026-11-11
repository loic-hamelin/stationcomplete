// Analyse des 5 gares de référence (réponses réelles de l'API OSM, tests/fixtures).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFeatures } from './features';
import type { BBox, OsmElement } from './osm';
import { analyzeStation } from './quests';

const mesures = JSON.parse(readFileSync('tests/fixtures/mesures.json', 'utf8')) as {
	name: string;
	fichier: string;
	bbox: BBox;
}[];

function load(name: string) {
	const m = mesures.find((x) => x.name === name)!;
	const raw = JSON.parse(readFileSync(m.fichier, 'utf8'));
	const elements = (raw.elements ?? raw) as OsmElement[];
	const a = analyzeStation(elements, m.bbox, new Date('2026-11-05'));
	return { a, f: buildFeatures(elements, a, m.bbox) };
}

describe('gares de référence', () => {
	for (const m of mesures)
		it(`analyse ${m.name} sans erreur`, () => {
			const { a, f } = load(m.name);
			console.log(
				m.name,
				JSON.stringify({
					quais: a.platforms.length,
					voies: a.tracks.length,
					pancartes: a.stopSigns.length,
					completude: a.completeness,
					quetes: a.quests.reduce<Record<string, number>>(
						(s, q) => ((s[q.id] = (s[q.id] ?? 0) + 1), s),
						{}
					),
					objets: f.features.length
				})
			);
			// Un objet de carte par partie de quai (quai en plusieurs parties : une par partie).
			const parts = a.platforms.reduce((n, p) => n + (p.parts?.length ?? 1), 0);
			expect(f.features.length).toBe(
				parts +
					a.tracks.length +
					a.otherTracks.length +
					a.stopSigns.length +
					a.points.length +
					a.steps.length
			);
			// Aucune gare de référence n'a de quai découpé : aucun faux regroupement.
			expect(a.platforms.filter((p) => p.parts)).toEqual([]);
		});

	it('Ambérieu-en-Bugey : quais A, B-C, D-E-F inchangés par le regroupement', () => {
		const { a } = load('Ambérieu-en-Bugey');
		// D-E-F est cartographié deux fois (way et multipolygone superposés) : ils se recouvrent
		// sur toute leur longueur, ce ne sont pas des parties bout à bout.
		expect(a.platforms.map((p) => [p.ref.type, p.tags.ref])).toEqual([
			['way', 'A'],
			['way', 'B;C'],
			['way', 'D;E;F'],
			['relation', 'D;E;F']
		]);
		expect(a.completeness.platforms).toEqual({ done: 4, total: 4 });
	});
});

describe('copie de gare pour le serveur de test', () => {
	it('reste petite : voies le long des quais seulement, coupées et simplifiées', async () => {
		const { copyForTest } = await import('./upload');
		const m = mesures.find((x) => x.name === 'Ambérieu-en-Bugey')!;
		const els = JSON.parse(readFileSync(m.fichier, 'utf8')).elements as OsmElement[];
		const rails = new Set(analyzeStation(els, m.bbox).tracks.map((t) => t.way));
		const copy = copyForTest(els, m.bbox, { rails });
		expect(copy.length).toBeLessThan(200);
		expect(copy.every((e) => e.id < 0)).toBe(true);
		// Une fois recopiée, la gare garde ses 4 quais.
		expect(analyzeStation(copy, m.bbox).platforms).toHaveLength(4);
	});
});
