// « Sur place » : la position GPS, demandée ponctuellement, tombe dans l'emprise de la gare.
// Les numéros et les pancartes ne se saisissent que sur place (décision du 5 novembre 2026),
// sauf en mode démonstration. Le GPS n'est jamais suivi en continu (sobriété).
//
// Mode souterrain (underground.svelte.ts) : la position est vérifiée une fois à l'entrée de la
// gare, en surface (ou déclarée sur l'honneur faute de GPS), puis vaut 2 heures pour cette gare.
// C'est une règle de bonne foi, comme la règle « sur place » elle-même : elle n'empêche pas de
// tricher, elle rappelle qu'on relève ce qu'on voit.

import type { OnsiteMethod } from './core/edits.js';
import { setSurveyMethod, settings } from './edits.svelte.js';
import { server } from './osmserver.svelte.js';
import { isOnSite, type Station } from './stations.js';
import { activeUnderground } from './underground.svelte.js';

type Status = 'unknown' | 'checking' | 'onsite' | 'away' | 'denied';
export const where = $state<{ status: Status; station?: string; at?: number }>({
	status: 'unknown'
});

const FRESH_MS = 10 * 60 * 1000;
/** Précision au-delà de laquelle la position ne dit rien (isOnSite la refuse aussi). */
const PRECISE_M = 100;

/**
 * Demande la position une fois et dit si l'on est dans la gare : « onsite », « away » (position
 * précise, hors de la gare) ou « nogps » (refusée, indisponible, trop imprécise, délai dépassé).
 * `fresh` : position du moment, jamais une position gardée par le navigateur.
 */
export function locateAt(station: Station, fresh = false): Promise<'onsite' | 'away' | 'nogps'> {
	if (!('geolocation' in navigator)) {
		where.status = 'denied';
		return Promise.resolve('nogps');
	}
	where.status = 'checking';
	return new Promise((done) =>
		navigator.geolocation.getCurrentPosition(
			(p) => {
				const ok = isOnSite(station, p.coords.latitude, p.coords.longitude, p.coords.accuracy);
				where.status = ok ? 'onsite' : 'away';
				where.station = station.id;
				where.at = Date.now();
				done(ok ? 'onsite' : p.coords.accuracy <= PRECISE_M ? 'away' : 'nogps');
			},
			() => {
				where.status = 'denied';
				done('nogps');
			},
			// Mode souterrain (`fresh`) : position du moment, à l'entrée (pas celle d'il y a 1 min).
			{ enableHighAccuracy: true, maximumAge: fresh ? 0 : 60_000, timeout: 20_000 }
		)
	);
}

export function checkOnSite(station: Station) {
	void locateAt(station);
}

/** La règle « sur place » ne s'applique pas : mode démonstration ou serveur de test. */
export const surveyFree = () => settings.demo || server.id === 'dev';

/** Peut-on saisir ce qui se lit sur le terrain dans cette gare ? */
export function canSurvey(stationId: string) {
	// Serveur de test : tout y est fictif, la règle « sur place » ne s'applique pas.
	if (surveyFree()) return true;
	if (activeUnderground(stationId)) return true;
	return (
		where.status === 'onsite' &&
		where.station === stationId &&
		Date.now() - (where.at ?? 0) < FRESH_MS
	);
}

/** Comment « sur place » est établi en ce moment pour cette gare (noté dans la saisie). */
export function surveyMethod(stationId: string): OnsiteMethod | undefined {
	if (surveyFree()) return undefined;
	const mode = activeUnderground(stationId);
	if (mode) return mode.how;
	return canSurvey(stationId) ? 'gps' : undefined;
}

// Les saisies enregistrées notent la manière (edits.svelte.ts ne dépend pas de ce module).
setSurveyMethod(surveyMethod);
