// Mode souterrain : préférence locale « rc:underground », règle « sur place » de 2 heures pour
// une seule gare, manière notée dans les saisies (gps / gps-entree / declaration).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
});
vi.stubGlobal('dispatchEvent', () => true);

const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 13, 9, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});
afterEach(() => {
	vi.useRealTimers();
	store.clear();
	vi.resetModules();
});

describe('mode souterrain', () => {
	it('valable 2 h pour cette gare seulement, puis expire', async () => {
		const m = await import('./underground.svelte.js');
		expect(m.activeUnderground()).toBeUndefined();
		m.startUnderground('w1', 'Gare A', 'gps-entree');
		expect(m.activeUnderground('w1')?.how).toBe('gps-entree');
		expect(m.activeUnderground('w2')).toBeUndefined();
		expect(JSON.parse(store.get('rc:underground')!)).toMatchObject({
			station: 'w1',
			server: 'prod',
			until: T0 + 2 * HOUR
		});
		vi.setSystemTime(T0 + 2 * HOUR - 1);
		expect(m.activeUnderground('w1')).toBeDefined();
		vi.setSystemTime(T0 + 2 * HOUR);
		expect(m.activeUnderground('w1')).toBeUndefined();
	});

	it('survit au rechargement ; une autre gare remplace la précédente ; « Arrêter »', async () => {
		let m = await import('./underground.svelte.js');
		m.startUnderground('w1', 'Gare A', 'declaration');
		vi.resetModules();
		m = await import('./underground.svelte.js');
		expect(m.activeUnderground('w1')?.how).toBe('declaration');
		m.startUnderground('w2', 'Gare B', 'gps-entree');
		expect(m.activeUnderground('w1')).toBeUndefined();
		expect(m.activeUnderground('w2')).toBeDefined();
		m.stopUnderground();
		expect(m.activeUnderground()).toBeUndefined();
		expect(store.get('rc:underground')).toBe('null');
	});

	it('préférence expirée, mal formée ou trop longue (horloge changée) : ignorée', async () => {
		const set = (v: unknown) => store.set('rc:underground', JSON.stringify(v));
		const base = { server: 'prod', station: 'w1', name: 'A', how: 'gps-entree' };
		for (const v of [
			{ ...base, until: T0 - 1 },
			{ ...base, until: T0 + 3 * HOUR },
			{ ...base, until: T0 + HOUR, how: 'gps' },
			{ ...base, until: 'demain' }
		]) {
			set(v);
			vi.resetModules();
			const m = await import('./underground.svelte.js');
			expect(m.activeUnderground('w1')).toBeUndefined();
		}
	});

	it('serveur de test : le mode de la vraie carte ne s’y applique pas', async () => {
		const m = await import('./underground.svelte.js');
		m.startUnderground('w1', 'Gare A', 'gps-entree');
		const { setServer } = await import('./osmserver.svelte.js');
		setServer('dev');
		expect(m.activeUnderground('w1')).toBeUndefined();
	});
});

describe('règle « sur place » et manière notée', () => {
	it('mode actif : sur place sans GPS, manière du mode ; sinon rien', async () => {
		const { canSurvey, surveyMethod } = await import('./onsite.svelte.js');
		const m = await import('./underground.svelte.js');
		expect(canSurvey('w1')).toBe(false);
		expect(surveyMethod('w1')).toBeUndefined();
		m.startUnderground('w1', 'Gare A', 'declaration');
		expect(canSurvey('w1')).toBe(true);
		expect(surveyMethod('w1')).toBe('declaration');
		expect(canSurvey('w2')).toBe(false);
		vi.setSystemTime(T0 + 2 * HOUR + 1);
		expect(canSurvey('w1')).toBe(false);
	});

	it('mode démonstration : règle inchangée (tout permis), aucune manière notée', async () => {
		const { setDemo } = await import('./edits.svelte.js');
		const { canSurvey, surveyMethod } = await import('./onsite.svelte.js');
		setDemo(true);
		expect(canSurvey('w9')).toBe(true);
		expect(surveyMethod('w9')).toBeUndefined();
	});
});
