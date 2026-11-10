// Gares favorites (préférence locale « rc:favorites »).
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
});

afterEach(() => {
	store.clear();
	vi.resetModules();
});

describe('gares favorites', () => {
	it('aucune au départ ; ajout puis retrait, enregistrés sur le téléphone', async () => {
		const { favorites, isFavorite, toggleFavorite } = await import('./favorites.svelte.js');
		expect(favorites.ids).toEqual([]);
		expect(toggleFavorite('w67074448')).toBe(true);
		expect(toggleFavorite('n1')).toBe(true);
		expect(favorites.ids).toEqual(['n1', 'w67074448']);
		expect(isFavorite('w67074448')).toBe(true);
		expect(JSON.parse(store.get('rc:favorites')!)).toEqual(['n1', 'w67074448']);
		expect(toggleFavorite('w67074448')).toBe(false);
		expect(isFavorite('w67074448')).toBe(false);
		expect(JSON.parse(store.get('rc:favorites')!)).toEqual(['n1']);
	});
	it('retrouvées au lancement suivant ; valeur abîmée ignorée', async () => {
		store.set('rc:favorites', JSON.stringify(['n1', 'n1', 3, 'w2']));
		expect((await import('./favorites.svelte.js')).favorites.ids).toEqual(['n1', 'w2']);
		vi.resetModules();
		store.set('rc:favorites', JSON.stringify({ x: 1 }));
		expect((await import('./favorites.svelte.js')).favorites.ids).toEqual([]);
	});
});
