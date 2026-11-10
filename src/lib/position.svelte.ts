// Position approximative pour « Choisir une gare » (E3) : gares proches, tri des résultats par
// distance, « À compléter près de vous ». Demandée ponctuellement (jamais suivie), précision
// réduite, gardée en mémoire seulement (jamais enregistrée ni envoyée) ; une position de moins
// de 5 minutes est réutilisée.

import { t } from './i18n/t.js';

export interface Here {
	lat: number;
	lon: number;
	at: number;
}

export const position = $state<{ here: Here | null; locating: boolean; error: string }>({
	here: null,
	locating: false,
	error: ''
});

const MAX_AGE_MS = 5 * 60 * 1000;

/** Demande la position (au premier appui : le navigateur demande l'autorisation). */
export function locate(): Promise<Here | null> {
	position.error = '';
	if (position.here && Date.now() - position.here.at < MAX_AGE_MS)
		return Promise.resolve(position.here);
	if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
		position.error = t('stations.geoUnavailable');
		return Promise.resolve(null);
	}
	position.locating = true;
	return new Promise((done) =>
		navigator.geolocation.getCurrentPosition(
			(p) => {
				position.locating = false;
				position.here = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
				done(position.here);
			},
			() => {
				position.locating = false;
				position.error = t('stations.geoError');
				done(null);
			},
			{ enableHighAccuracy: false, maximumAge: MAX_AGE_MS, timeout: 15_000 }
		)
	);
}

/**
 * Position sans rien demander : seulement si l'utilisateur l'a déjà autorisée (pas de fenêtre
 * d'autorisation à l'ouverture de la page).
 */
export async function locateIfAllowed() {
	try {
		const p = await navigator.permissions?.query({ name: 'geolocation' });
		if (p?.state === 'granted') await locate();
	} catch {
		/* API des autorisations absente : on attend l'appui sur « Autour de moi » */
	}
}
