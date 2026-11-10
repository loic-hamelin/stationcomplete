// Recherche d'une gare (E3) : pertinence, accents, « St » = « Saint », tri par distance, et
// lecture des jauges de l'index (11e colonne, facultative).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BBox } from './core/osm';
import { gaugesOfRow, groupByCountry, search, todoCount, type Station } from './stations';

type Row = [string, string, string, string, string, string, number, number, 'S' | 'H', BBox];
const index = JSON.parse(readFileSync('static/data/stations-fr.json', 'utf8')) as { s: Row[] };
const FR: Station[] = index.s.map(
	([id, name, norm, commune, admin, uic, lat, lon, type, bbox]) => ({
		id,
		name,
		norm,
		commune,
		admin,
		uic,
		lat,
		lon,
		halt: type === 'H',
		bbox,
		country: 'fr'
	})
);

const st = (
	name: string,
	commune = '',
	lat = 46,
	lon = 5,
	extra: Partial<Station> = {}
): Station => ({
	id: 'n' + name,
	name,
	norm: name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim(),
	commune,
	admin: '',
	uic: '',
	lat,
	lon,
	halt: false,
	bbox: [lon, lat, lon, lat],
	country: 'fr',
	...extra
});
const names = (l: Station[]) => l.map((s) => s.name);

// Position fictive à 2 km d'Ambérieu-en-Bugey.
const NEAR_AMBERIEU = { lat: 45.97, lon: 5.355 };

describe('recherche d’une gare', () => {
	it('« amb » près d’Ambérieu : Ambérieu-en-Bugey en premier (index réel)', () => {
		// Sans position : ordre de pertinence puis nom le plus court (Ambérieu n'est pas 1er).
		const without = names(search(FR, 'amb'));
		expect(without[0]).not.toBe('Ambérieu-en-Bugey');
		const near = names(search(FR, 'amb', 30, NEAR_AMBERIEU));
		expect(near[0]).toBe('Ambérieu-en-Bugey');
		// Les débuts de nom restent devant une correspondance dans la commune, même plus proche.
		const firstElsewhere = near.findIndex((n) => !n.toLowerCase().startsWith('amb'));
		expect(near.slice(0, firstElsewhere).every((n) => /^amb/i.test(n))).toBe(true);
	});

	it('pertinence : début du nom > début d’un mot > commune > ailleurs', () => {
		const list = [
			st('Lambersart'), // ailleurs
			st('Gare de Porcieu', 'Porcieu-Amblagnieu'), // début d'un mot de la commune
			st('Pont-Ambert'), // début d'un mot
			st('Ambert') // début du nom
		];
		expect(names(search(list, 'amb'))).toEqual([
			'Ambert',
			'Pont-Ambert',
			'Gare de Porcieu',
			'Lambersart'
		]);
	});

	it('insensible aux accents, à la casse, aux tirets et aux apostrophes', () => {
		const list = [st('Ambérieu-en-Bugey'), st("Pont-d'Ain"), st('L’Isle-Adam')];
		expect(names(search(list, 'AMBERIEU EN'))).toEqual(['Ambérieu-en-Bugey']);
		expect(names(search(list, 'ambérieu-en-bugey'))).toEqual(['Ambérieu-en-Bugey']);
		expect(names(search(list, 'pont d’ain'))).toEqual(["Pont-d'Ain"]);
		expect(names(search(list, 'pontdain'))).toEqual(["Pont-d'Ain"]);
		expect(names(search(list, 'lisle'))).toEqual(['L’Isle-Adam']);
	});

	it('« St »/« Ste » valent « Saint »/« Sainte », dans les deux sens', () => {
		const list = [st('Saint-Rambert-en-Bugey'), st('Ste-Foy-lès-Lyon'), st('Strasbourg')];
		expect(names(search(list, 'st rambert'))).toEqual(['Saint-Rambert-en-Bugey']);
		expect(names(search(list, 'sainte foy'))).toEqual(['Ste-Foy-lès-Lyon']);
		expect(names(search(list, 'ste-foy'))).toEqual(['Ste-Foy-lès-Lyon']);
		// « st » seul : les deux lectures (Saint…, Strasbourg).
		expect(names(search(list, 'st')).sort()).toEqual([
			'Saint-Rambert-en-Bugey',
			'Ste-Foy-lès-Lyon',
			'Strasbourg'
		]);
		// Index réel : « st rambert » trouve Saint-Rambert-en-Bugey.
		expect(names(search(FR, 'st rambert en'))[0]).toBe('Saint-Rambert-en-Bugey');
	});

	it('à pertinence égale : la plus proche d’abord ; sans position, la plus courte', () => {
		const list = [st('Ambert', '', 45.55, 3.74), st('Amboise', '', 47.42, 0.98)];
		expect(names(search(list, 'amb'))).toEqual(['Ambert', 'Amboise']);
		expect(names(search(list, 'amb', 30, { lat: 47.4, lon: 1 }))).toEqual(['Amboise', 'Ambert']);
	});

	it('code UIC, deux lettres au moins, limite', () => {
		const list = [st('Ambérieu', '', 46, 5, { uic: '8774300' })];
		expect(names(search(list, '87743'))).toEqual(['Ambérieu']);
		expect(search(list, 'a')).toEqual([]);
		expect(search(FR, 'gare', 5)).toHaveLength(5);
	});

	it('groupes par pays : le pays courant d’abord', () => {
		const a = st('A'),
			b = st('B', '', 46, 7, { country: 'ch' });
		expect(groupByCountry([b, a], 'fr').map((g) => g.country)).toEqual(['fr', 'ch']);
		expect(groupByCountry([a], 'fr')).toEqual([{ country: 'fr', stations: [a] }]);
	});
});

describe('jauges de l’index', () => {
	it('11e colonne facultative : absente ou mal formée → pas de jauges', () => {
		expect(gaugesOfRow(undefined)).toBeUndefined();
		expect(gaugesOfRow([1, 2, 3])).toBeUndefined();
		expect(gaugesOfRow([1, 2, 3, 4, 5, -1])).toBeUndefined();
		expect(gaugesOfRow([4, 4, 5, 8, 1, 6])).toEqual({
			platforms: { done: 4, total: 4 },
			tracks: { done: 5, total: 8 },
			stopSigns: { done: 1, total: 6 }
		});
	});
	it('reste à faire : manques des trois jauges, 1 pour une gare sans quai', () => {
		expect(todoCount(gaugesOfRow([4, 4, 5, 8, 1, 6])!)).toBe(8);
		expect(todoCount(gaugesOfRow([0, 0, 0, 0, 0, 0])!)).toBe(1);
		expect(todoCount(gaugesOfRow([2, 2, 3, 3, 4, 4])!)).toBe(0);
	});
});
