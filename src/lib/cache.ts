// Cache local (IndexedDB) des données de gare déjà chargées, pour la consultation hors-ligne
// et pour éviter de solliciter l'API OSM à chaque ouverture.

import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import type { OsmElement } from './core/osm.js';

export interface CachedStation {
	id: string;
	fetchedAt: number;
	elements: OsmElement[];
}

let db: Promise<IDBPDatabase> | undefined;
function open() {
	db ??= openDB('stationcomplete', 2, {
		upgrade(d, oldVersion) {
			if (oldVersion < 1) d.createObjectStore('stations', { keyPath: 'id' });
			// Lot 2 : modifications saisies, en attente d'envoi vers OpenStreetMap.
			if (oldVersion < 2) d.createObjectStore('edits', { keyPath: 'id' });
		}
	});
	return db;
}

export async function getCachedStation(id: string): Promise<CachedStation | undefined> {
	try {
		return await (await open()).get('stations', id);
	} catch {
		return undefined; // navigation privée ou stockage refusé : on fonctionne sans cache
	}
}

/** Clés des gares en cache (sans leurs données) : jauges exactes sur la page E3. */
export async function getCachedStationKeys(): Promise<string[]> {
	try {
		return (await (await open()).getAllKeys('stations')).map(String);
	} catch {
		return [];
	}
}

export async function putCachedStation(entry: CachedStation) {
	try {
		await (await open()).put('stations', entry);
	} catch {
		/* sans cache */
	}
}

export async function deleteCachedStation(id: string) {
	try {
		await (await open()).delete('stations', id);
	} catch {
		/* rien à supprimer */
	}
}

export async function getAllEdits<T>(): Promise<T[]> {
	try {
		return (await (await open()).getAll('edits')) as T[];
	} catch {
		return [];
	}
}
export async function putEdit(edit: { id: string }) {
	// Pas de repli silencieux ici : perdre une saisie doit se voir.
	await (await open()).put('edits', edit);
}
export async function deleteEdit(id: string) {
	await (await open()).delete('edits', id);
}

// Préférences légères (gares récentes, présentation vue) : localStorage, protégé.
export function readPref<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(`rc:${key}`);
		return v ? (JSON.parse(v) as T) : fallback;
	} catch {
		return fallback;
	}
}
export function writePref(key: string, value: unknown) {
	try {
		localStorage.setItem(`rc:${key}`, JSON.stringify(value));
	} catch {
		/* sans préférences */
	}
}

/**
 * Efface tout ce que stationcomplete garde sur ce téléphone (page Données personnelles) :
 * gares, saisies non envoyées, préférences, connexion OSM, photos aériennes téléchargées.
 */
export async function wipeAll() {
	try {
		(await db)?.close();
	} catch {
		/* base déjà fermée */
	}
	db = undefined;
	try {
		await deleteDB('stationcomplete');
	} catch {
		/* rien à effacer */
	}
	try {
		// Préférences (rc:…) et jetons d'osm-auth (clés « <serveur>oauth2_access_token », etc.).
		for (const k of Object.keys(localStorage))
			if (k.startsWith('rc:') || k.includes('oauth')) localStorage.removeItem(k);
		sessionStorage.clear();
	} catch {
		/* stockage indisponible */
	}
	if ('caches' in globalThis)
		for (const k of await caches.keys())
			// Photos des gares téléchargées et dernier état officiel des équipements (D4 bis).
			if (k.startsWith('rc-tiles') || k === 'rc-status') await caches.delete(k);
}
