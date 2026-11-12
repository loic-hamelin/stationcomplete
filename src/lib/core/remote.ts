// Interrupteur d'arrêt d'urgence (architecture § 8.4) : le fichier public /config.json,
// modifié à la main sur GitHub, peut couper les envois pour tous sans republier l'appli.

import { t as tr } from '../i18n/t.ts';

export interface RemoteConfig {
	/** false : plus aucun envoi, sur aucun serveur. */
	uploadsEnabled: boolean;
	/** Version minimale de l'appli autorisée à envoyer (ex. « 0.4 »). */
	minVersion: string;
	/** Message affiché à tous (panne, consigne), ou null. */
	message: string | null;
	/**
	 * Phase pilote : pseudos OSM autorisés à envoyer sur la vraie carte.
	 * null = tout le monde. Ne concerne pas le serveur de test.
	 */
	pilotUsers: string[] | null;
	/**
	 * false : l'état officiel des ascenseurs et escaliers mécaniques (D4 bis) n'est plus lu ni
	 * affiché, sans republier l'appli (source fausse, changement de format, demande de l'exploitant).
	 */
	officialStatusEnabled: boolean;
}

export const DEFAULT_CONFIG: RemoteConfig = {
	uploadsEnabled: true,
	minVersion: '0',
	message: null,
	pilotUsers: null,
	officialStatusEnabled: true
};

/** Lit un config.json en tolérant les champs absents ou mal formés. */
export function parseConfig(raw: unknown): RemoteConfig {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		uploadsEnabled: o.uploadsEnabled !== false,
		minVersion: typeof o.minVersion === 'string' ? o.minVersion : '0',
		message: typeof o.message === 'string' && o.message.trim() ? o.message.trim() : null,
		pilotUsers: Array.isArray(o.pilotUsers)
			? o.pilotUsers.filter((u): u is string => typeof u === 'string')
			: null,
		officialStatusEnabled: o.officialStatusEnabled !== false
	};
}

/** Compare deux versions « 1.2.3 » : négatif si a < b. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
	const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

/**
 * Raison pour laquelle l'envoi est bloqué, ou undefined s'il est permis.
 * `user` : pseudo OSM connecté (s'il est connu) ; `real` : vraie carte (pas le serveur de test).
 */
export function uploadBlock(
	cfg: RemoteConfig,
	version: string,
	real: boolean,
	user?: string
): string | undefined {
	if (!cfg.uploadsEnabled) return cfg.message ?? tr('remote.suspended');
	if (compareVersions(version, cfg.minVersion) < 0) return tr('remote.update');
	if (real && cfg.pilotUsers && !(user && cfg.pilotUsers.includes(user))) return tr('remote.pilot');
	return undefined;
}
