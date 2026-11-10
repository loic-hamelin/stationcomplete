// Gare en cours de consultation, partagée entre le tableau de bord (E4) et la carte (E5).

import { getCachedStation, putCachedStation, readPref, writePref } from './cache.js';
import { analyzeStation, type StationAnalysis } from './core/quests.js';
import type { OsmElement } from './core/osm.js';
import { stationCacheKey } from './core/storage.js';
import { fetchStationData, OsmApiError } from './osmapi.js';
import { server } from './osmserver.svelte.js';
import { country } from './country.svelte.js';
import { findStation, type Station } from './stations.js';
import { t } from './i18n/t.js';

// Clé du cache local : une gare chargée depuis le serveur de test ne se mélange pas à la vraie
// (sans le pays : clé inchangée par le lot P1, voir core/storage.ts).
const cacheKey = (id: string) => stationCacheKey(server.id, id);

type State =
	| { status: 'idle' }
	| { status: 'loading'; station?: Station }
	| { status: 'error'; station?: Station; message: string }
	| {
			status: 'ready';
			station: Station;
			elements: OsmElement[];
			analysis: StationAnalysis;
			fetchedAt: number;
			fromCache: boolean;
			server: string;
	  };

export const current = $state<{ value: State }>({ value: { status: 'idle' } });

const MAX_AGE_MS = 24 * 3600 * 1000; // au-delà, on recharge si le réseau est là

export async function openStation(id: string, { force = false } = {}) {
	const prev = current.value;
	if (!force && prev.status === 'ready' && prev.station.id === id && prev.server === server.id)
		return;
	current.value = { status: 'loading' };
	let station: Station | undefined;
	try {
		station = await findStation(id, country.code);
	} catch (e) {
		current.value = { status: 'error', message: (e as Error).message };
		return;
	}
	if (!station) {
		current.value = { status: 'error', message: t('error.stationNotFound') };
		return;
	}
	current.value = { status: 'loading', station };
	rememberRecent(station.id);

	const cached = await getCachedStation(cacheKey(id));
	const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE_MS;
	if (cached && (!force || !navigator.onLine) && (fresh || !navigator.onLine)) {
		ready(station, cached.elements, cached.fetchedAt, true);
		return;
	}
	try {
		const elements = await fetchStationData(station.bbox);
		const fetchedAt = Date.now();
		await putCachedStation({ id: cacheKey(id), fetchedAt, elements });
		ready(station, elements, fetchedAt, false);
	} catch (e) {
		if (cached) ready(station, cached.elements, cached.fetchedAt, true);
		else
			current.value = {
				status: 'error',
				station,
				message: e instanceof OsmApiError ? e.message : t('error.osmUnreachable')
			};
	}
}

function ready(station: Station, elements: OsmElement[], fetchedAt: number, fromCache: boolean) {
	current.value = {
		status: 'ready',
		station,
		elements,
		analysis: analyzeStation(elements, station.bbox, undefined, station.country),
		fetchedAt,
		fromCache,
		server: server.id
	};
}

/** Oublie la gare affichée (changement de serveur). */
export function resetStation() {
	current.value = { status: 'idle' };
}

export function recentIds(): string[] {
	return readPref<string[]>('recent', []);
}
function rememberRecent(id: string) {
	writePref('recent', [id, ...recentIds().filter((x) => x !== id)].slice(0, 8));
	writePref('lastOpened', { id, at: Date.now() });
}

/** Dernière gare ouverte et quand (carte « Reprendre » de E3), si connue. */
export function lastOpened(): { id: string; at: number } | undefined {
	const v = readPref<{ id?: unknown; at?: unknown } | null>('lastOpened', null);
	return v && typeof v.id === 'string' && typeof v.at === 'number'
		? { id: v.id, at: v.at }
		: undefined;
}
