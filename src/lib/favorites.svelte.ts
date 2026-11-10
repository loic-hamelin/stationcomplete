// Gares favorites (E3) : préférence locale « rc:favorites » (identifiants OSM, les plus récentes
// d'abord). Rien n'est envoyé : la liste reste sur le téléphone.

import { readPref, writePref } from './cache.js';

const MAX = 50;
const clean = (v: unknown): string[] =>
	Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];

export const favorites = $state<{ ids: string[] }>({
	ids: clean(readPref<unknown>('favorites', [])).slice(0, MAX)
});

export const isFavorite = (id: string) => favorites.ids.includes(id);

/** Ajoute ou retire une gare des favorites ; renvoie le nouvel état (true : favorite). */
export function toggleFavorite(id: string): boolean {
	const on = !isFavorite(id);
	favorites.ids = on ? [id, ...favorites.ids].slice(0, MAX) : favorites.ids.filter((x) => x !== id);
	writePref('favorites', favorites.ids);
	return on;
}
