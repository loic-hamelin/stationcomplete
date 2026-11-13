// Mode souterrain (13 novembre 2026, validé par Loïc) : dans une gare souterraine, ni GPS ni
// réseau. La règle « sur place » (onsite.svelte.ts) est établie une fois, à l'entrée, en
// surface — par le GPS, ou à défaut par une déclaration sur l'honneur — puis vaut 2 heures pour
// CETTE gare seulement, même sans GPS ni réseau ensuite. L'état est une préférence locale
// (« rc:underground » : gare, serveur, heure d'expiration), qui survit au rechargement.
//
// Module chargé à la demande (pages de gare, bandeau) : NetStatus ne lit au démarrage que la
// présence de la préférence, et l'événement « rc:underground » le prévient des changements.
// Le parcours d'activation est dans UndergroundStart.svelte, le bandeau dans UndergroundBand.

import { readPref, writePref } from './cache.js';
import type { OnsiteMethod } from './core/edits.js';
import { server, type ServerId } from './osmserver.svelte.js';

/** Durée de validité du mode : 2 heures. */
export const UNDERGROUND_MS = 2 * 3600 * 1000;

export interface UndergroundMode {
	server: ServerId;
	station: string;
	/** Nom de la gare, pour le bandeau (affiché sur toutes les pages). */
	name: string;
	/** Heure d'expiration (ms). */
	until: number;
	/** GPS vérifié à l'entrée, ou déclaration sur l'honneur. */
	how: Exclude<OnsiteMethod, 'gps'>;
}

const KEY = 'underground';

function load(): UndergroundMode | undefined {
	const m = readPref<Partial<UndergroundMode> | null>(KEY, null);
	if (
		!m ||
		typeof m.station !== 'string' ||
		typeof m.name !== 'string' ||
		typeof m.until !== 'number' ||
		(m.how !== 'gps-entree' && m.how !== 'declaration') ||
		(m.server !== 'prod' && m.server !== 'dev') ||
		// Une durée plus longue que 2 h (horloge du téléphone changée) n'est pas crue.
		m.until - Date.now() > UNDERGROUND_MS
	)
		return undefined;
	return m.until > Date.now() ? (m as UndergroundMode) : undefined;
}

export const underground = $state<{ mode?: UndergroundMode }>({ mode: load() });

/** Mode actif (pour cette gare si `station` est donnée), sur le serveur choisi. */
export function activeUnderground(station?: string): UndergroundMode | undefined {
	const m = underground.mode;
	if (!m || m.server !== server.id || Date.now() >= m.until) return undefined;
	return station === undefined || m.station === station ? m : undefined;
}

/** Active le mode pour une gare (remplace celui d'une autre gare). */
export function startUnderground(station: string, name: string, how: UndergroundMode['how']) {
	underground.mode = { server: server.id, station, name, until: Date.now() + UNDERGROUND_MS, how };
	writePref(KEY, $state.snapshot(underground.mode));
	dispatchEvent(new Event('rc:underground'));
}

/** Arrête le mode (bouton « Arrêter », ou expiration). */
export function stopUnderground() {
	underground.mode = undefined;
	writePref(KEY, null);
	dispatchEvent(new Event('rc:underground'));
}
