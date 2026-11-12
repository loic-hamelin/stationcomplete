// État officiel des ascenseurs et escaliers mécaniques (D4 bis, lot S1) : adaptateur SNCF
// (requêtes filtrées par gare, lecture tolérante, états), cache en mémoire, panne de la source.
// La fixture est RÉDIGÉE d'après la documentation (voir son champ « _note »), pas réelle.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { COUNTRIES } from './countries';
import {
	MEMORY_TTL,
	STALE_HEADER,
	countStates,
	normalizeKey,
	parseEquipment,
	parseState,
	readOfficialStatus,
	sncfStationsUrl,
	sncfStatusUrl,
	stationIdsFromUic,
	statusSourceFor,
	uic7,
	type StatusDeps
} from './officialStatus';

const fixture = JSON.parse(readFileSync('tests/fixtures/sncf-etat-officiel-redige.json', 'utf8'));
const source = COUNTRIES.fr.equipmentStatus!;
const amberieu = { id: 'w67074448', uic: '8774371' };
const ORIGIN = 'https://ressources.data.sncf.com';

/** Faux réseau : référentiel et état d'après la fixture ; journal des URL demandées. */
function fakeNet(
	opts: { fail?: boolean; status?: unknown; headers?: Record<string, string> } = {}
) {
	const urls: string[] = [];
	const inits: (RequestInit | undefined)[] = [];
	const fetch = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
		const url = String(u);
		urls.push(url);
		inits.push(init);
		if (opts.fail) throw new TypeError('Failed to fetch');
		const body = url.includes('/gares-de-voyageurs/')
			? fixture.stations
			: (opts.status ?? fixture.status);
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json', ...opts.headers }
		});
	}) as unknown as typeof globalThis.fetch;
	let t = 1_000_000;
	const deps: StatusDeps = { fetch, now: () => t, cache: new Map() };
	return { deps, urls, inits, advance: (ms: number) => (t += ms) };
}

describe('lecture tolérante', () => {
	it('normalise les noms de champs comme Opendatasoft', () => {
		expect(normalizeKey('Nom de l’équipement')).toBe('nom_de_l_equipement');
		expect(normalizeKey("Etat de fonctionnement de l'équipement")).toBe(
			'etat_de_fonctionnement_de_l_equipement'
		);
		expect(normalizeKey('Id_Gare')).toBe('id_gare');
	});
	it('lit les trois états, et « inconnu » pour toute autre valeur ou une valeur absente', () => {
		expect(parseState('OK')).toBe('ok');
		expect(parseState(' ko ')).toBe('ko');
		expect(parseState('Hors service')).toBe('ko');
		expect(parseState('Inconnu')).toBe('unknown');
		expect(parseState(undefined)).toBe('unknown');
		expect(parseState('???')).toBe('unknown');
	});
	it('garde les 7 premiers chiffres d’un code UIC valide', () => {
		expect(uic7('8774300')).toBe('8774300');
		expect(uic7('87743005')).toBe('8774300');
		expect(uic7('')).toBe('');
		expect(uic7('87-743')).toBe('');
	});
});

describe('adaptateur SNCF Gares & Connexions', () => {
	it('retrouve Id_Gare par le code UIC, exactement (pas la gare voisine)', () => {
		expect(stationIdsFromUic(fixture.stations, '8774371')).toEqual(['fictif-amberieu']);
		expect(stationIdsFromUic(fixture.stations, '8774399')).toEqual(['fictif-autre']);
		expect(stationIdsFromUic(fixture.stations, '8700000')).toEqual([]);
		// Code en liste ou en nombre, plusieurs codes : acceptés
		const list = { results: [{ Id_Gare: 'a', Code_UIC: ['87000018', '87743005'] }] };
		expect(stationIdsFromUic(list, '8774300')).toEqual(['a']);
		// Identifiant suspect (guillemet) : refusé, jamais recopié dans une requête
		const evil = { results: [{ id_gare: 'x" OR "1"="1', codes_uic: '87743005' }] };
		expect(stationIdsFromUic(evil, '8774300')).toEqual([]);
	});
	it('ne demande que la gare ouverte (filtre), jamais le jeu entier', () => {
		const ref = new URL(sncfStationsUrl(ORIGIN, '8774300'));
		expect(ref.pathname).toBe('/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/records');
		expect(ref.searchParams.get('where')).toBe('search(*, "8774300")');
		const st = new URL(sncfStatusUrl(ORIGIN, ['fictif-amberieu']));
		expect(st.pathname).toBe(
			'/api/explore/v2.1/catalog/datasets/etat-fonctionnement-elevatique-gare/records'
		);
		expect(st.searchParams.get('where')).toBe('id_gare="fictif-amberieu"');
		expect(st.searchParams.get('limit')).toBe('100');
		expect(new URL(sncfStatusUrl(ORIGIN, ['a', 'b'])).searchParams.get('where')).toBe(
			'id_gare="a" OR id_gare="b"'
		);
	});
	it('lit les équipements de la gare : libellés tels quels, sans doublon, hors service d’abord', () => {
		const list = parseEquipment(fixture.status, ['fictif-amberieu']);
		expect(list.map((e) => [e.name, e.location, e.state])).toEqual([
			['Ascenseur - Quai 2/3', 'Voies 2 et 3 / Souterrain', 'ko'],
			['esc mec - Hall', 'Hall / Souterrain', 'unknown'],
			['Ascenseur - Quai 1', 'Quai 1 / Souterrain', 'ok']
		]);
		expect(countStates(list)).toEqual({ ok: 1, ko: 1, unknown: 1 });
	});
	it('tolère les libellés d’origine comme noms de champs', () => {
		const raw = {
			results: [
				{
					Id_Gare: 'g',
					Id_equipement: 'e',
					"Nom de l'équipement": 'Ascenseur',
					Localisation: 'Quai 1',
					'Etat de fonctionnement': 'KO'
				}
			]
		};
		expect(parseEquipment(raw, ['g'])).toEqual([
			{ id: 'e', name: 'Ascenseur', location: 'Quai 1', state: 'ko' }
		]);
	});
	it('données manquantes : état absent = inconnu ; ni nom ni localisation = ignoré', () => {
		const raw = {
			results: [
				{ id_gare: 'g', localisation: 'Quai 2' },
				{ id_gare: 'g', etat: 'OK' },
				null,
				'texte'
			]
		};
		expect(parseEquipment(raw, ['g'])).toEqual([
			{ id: '|Quai 2', name: '', location: 'Quai 2', state: 'unknown' }
		]);
	});
	it('refuse une réponse dont le format a changé', () => {
		expect(() => parseEquipment({ records: [] }, ['g'])).toThrow();
		expect(() => stationIdsFromUic(null, '8774300')).toThrow();
	});
});

describe('source d’un pays et arrêt d’urgence', () => {
	it('France : SNCF Gares & Connexions ; Suisse : rien pour l’instant', () => {
		expect(statusSourceFor('fr', { officialStatusEnabled: true })?.operator).toBe(
			'SNCF Gares & Connexions'
		);
		expect(statusSourceFor('ch', { officialStatusEnabled: true })).toBeNull();
	});
	it('config.json « officialStatusEnabled: false » coupe tout : aucune requête', async () => {
		const net = fakeNet();
		const off = statusSourceFor('fr', { officialStatusEnabled: false });
		expect(off).toBeNull();
		expect(await readOfficialStatus(amberieu, off, net.deps)).toEqual({ kind: 'none' });
		expect(net.urls).toHaveLength(0);
	});
});

describe('lecture avec cache', () => {
	it('deux requêtes filtrées, sans cookie ni adresse de page, puis la liste', async () => {
		const net = fakeNet();
		const r = await readOfficialStatus(amberieu, source, net.deps);
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.status.equipment).toHaveLength(3);
		expect(r.status.stale).toBe(false);
		expect(r.status.readAt).toBe(1_000_000);
		expect(net.urls).toHaveLength(2);
		expect(net.urls.every((u) => u.startsWith(ORIGIN + '/api/'))).toBe(true);
		for (const init of net.inits) {
			expect(init?.credentials).toBe('omit');
			expect(init?.referrerPolicy).toBe('no-referrer');
			expect(init?.method ?? 'GET').toBe('GET');
		}
	});
	it('garde le résultat 10 minutes en mémoire, puis relit ; « force » relit tout de suite', async () => {
		const net = fakeNet();
		await readOfficialStatus(amberieu, source, net.deps);
		net.advance(MEMORY_TTL - 1);
		await readOfficialStatus(amberieu, source, net.deps);
		expect(net.urls).toHaveLength(2);
		net.advance(2);
		await readOfficialStatus(amberieu, source, net.deps);
		expect(net.urls).toHaveLength(4);
		await readOfficialStatus(amberieu, source, net.deps, true);
		expect(net.urls).toHaveLength(6);
	});
	it('gare non couverte : pas d’UIC, UIC inconnu, aucun équipement, ou pays sans source', async () => {
		const net = fakeNet();
		expect(await readOfficialStatus({ id: 'n1', uic: '' }, source, net.deps)).toEqual({
			kind: 'none'
		});
		expect(net.urls).toHaveLength(0);
		expect(await readOfficialStatus({ id: 'n2', uic: '8700000' }, source, net.deps)).toEqual({
			kind: 'none'
		});
		expect(net.urls).toHaveLength(1);
		const empty = fakeNet({ status: { total_count: 0, results: [] } });
		expect((await readOfficialStatus(amberieu, source, empty.deps)).kind).toBe('none');
		expect(await readOfficialStatus(amberieu, null, net.deps)).toEqual({ kind: 'none' });
	});
	it('source injoignable ou en erreur : « error », non gardé en cache', async () => {
		const down = fakeNet({ fail: true });
		expect(await readOfficialStatus(amberieu, source, down.deps)).toEqual({ kind: 'error' });
		expect(down.deps.cache.size).toBe(0);
		const net = fakeNet();
		net.deps.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
		expect(await readOfficialStatus(amberieu, source, net.deps)).toEqual({ kind: 'error' });
		const bad = fakeNet({ status: { error: 'x' } });
		expect(await readOfficialStatus(amberieu, source, bad.deps)).toEqual({ kind: 'error' });
	});
	it('réponse de secours du service worker : marquée ancienne, avec son heure, non gardée', async () => {
		const net = fakeNet({ headers: { [STALE_HEADER]: '900000' } });
		const r = await readOfficialStatus(amberieu, source, net.deps);
		expect(r.kind === 'ok' && r.status).toMatchObject({ stale: true, readAt: 900_000 });
		expect(net.deps.cache.size).toBe(0);
	});
});
