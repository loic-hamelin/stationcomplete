// État officiel des ascenseurs et escaliers mécaniques d'une gare (décision D4 bis, lot S1).
//
// L'appli lit, gare par gare et en lecture seule, l'état publié en open data par l'exploitant du
// pays de la gare (configuration `equipmentStatus` de countries.ts). Rien n'est écrit, rien n'est
// stocké par stationcomplete, aucun identifiant de l'utilisateur n'est envoyé : la requête part
// sans cookie (`credentials: 'omit'`) et sans adresse de page (`referrerPolicy: 'no-referrer'`).
//
// Chaque exploitant a son adaptateur, qui seul connaît le format de la source. Code pur (les
// accès réseau et l'horloge sont fournis par l'appelant), testé par officialStatus.test.ts.
//
// ─── SNCF Gares & Connexions ──────────────────────────────────────────────────────────────────
// Jeu « Etat de fonctionnement des équipements d'élévatique en gare » (identifiant
// `etat-fonctionnement-elevatique-gare` sur ressources.data.sncf.com, API Opendatasoft
// « Explore v2.1 »), ODbL, mis à jour toutes les heures, « non contractuel ». Champs documentés
// (data.gouv.fr, 11/11/2026) : Id_Gare, Id_equipement, Nom de l'équipement, Localisation,
// Etat de fonctionnement = OK / KO / Inconnu. Pas de code UIC : la gare se retrouve par le jeu
// « Gares de voyageurs » (Id_Gare et Code_UIC), comme l'a indiqué Gares & Connexions
// (data.gouv.fr, 24/04/2026).
//
// VÉRIFIÉ le 13/11/2026 sur des réponses réelles ouvertes dans un navigateur :
//   - jeu d'état : champs `gareid`, `id`, `libelle`, `localisationdescriptive`,
//     `etat_de_fonctionnement` (OK / KO / Inconnu) ; le filtre `where` porte sur `gareid` ;
//   - référentiel `gares-de-voyageurs` : `id` (= gareid), `nom`, `codes_uic` sur 8 chiffres
//     (« 87743716 ») ; la recherche plein texte sur les 7 premiers chiffres le trouve.
// [NON VÉRIFIÉ] : les en-têtes CORS de l'API (essai dans la console de stationcomplete.org).
// Points à vérifier dans un navigateur : docs/signalements/s1-verifications.md.

import { countryConfig, type EquipmentStatusSource } from './countries.ts';
import type { RemoteConfig } from './remote.ts';

export type EquipmentState = 'ok' | 'ko' | 'unknown';

/** Un équipement tel que publié par l'exploitant (libellés repris tels quels). */
export interface OfficialEquipment {
	id: string;
	name: string;
	location: string;
	state: EquipmentState;
}

export interface OfficialStatus {
	equipment: OfficialEquipment[];
	/** Heure de lecture de la source (ms) ; ancienne si `stale`. */
	readAt: number;
	/** Réponse servie hors connexion par le service worker (quelques heures au plus). */
	stale: boolean;
}

/**
 * ok : liste à afficher ; none : gare non couverte (rien à afficher) ; error : source
 * injoignable ou réponse illisible (message discret).
 */
export type StatusResult =
	{ kind: 'ok'; status: OfficialStatus } | { kind: 'none' } | { kind: 'error' };

/** Ce que l'adaptateur sait d'une gare de l'index. */
export interface StatusStation {
	/** Code UIC de l'index (tag OSM `uic_ref`), souvent 7 chiffres ; '' si inconnu. */
	uic: string;
}

/** Réponse JSON lue sur le réseau (ou dans le service worker, `stale`). */
export interface JsonResponse {
	json: unknown;
	/** Heure d'origine de la réponse (ms). */
	at: number;
	stale: boolean;
}
export type GetJson = (url: string) => Promise<JsonResponse>;

export interface StatusAdapter {
	/** Équipements de la gare, ou null si la gare n'est pas couverte. Rejette si la source échoue. */
	read(
		station: StatusStation,
		source: EquipmentStatusSource,
		get: GetJson
	): Promise<{ equipment: OfficialEquipment[]; at: number; stale: boolean } | null>;
}

/** En-tête posé par le service worker sur une réponse servie depuis son cache. */
export const STALE_HEADER = 'x-rc-fetched-at';
/** Durée du cache en mémoire (une nouvelle lecture au plus toutes les 10 minutes par gare). */
export const MEMORY_TTL = 10 * 60_000;
/** Âge maximal d'une réponse servie hors connexion par le service worker. */
export const OFFLINE_MAX_AGE = 3 * 3600_000;

// ---------- Lecture tolérante des enregistrements ----------

/** « Nom de l'équipement » → « nom_de_l_equipement » (règle de nommage d'Opendatasoft). */
export const normalizeKey = (k: string) =>
	k
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

/** Valeur du premier champ dont le nom normalisé satisfait `test`. */
function field(rec: Record<string, unknown>, test: (k: string) => boolean): unknown {
	for (const [k, v] of Object.entries(rec)) if (test(normalizeKey(k))) return v;
	return undefined;
}

const text = (v: unknown, max = 160): string =>
	typeof v === 'string' || typeof v === 'number'
		? String(v).replace(/\s+/g, ' ').trim().slice(0, max)
		: '';

/** Enregistrements d'une réponse Explore v2.1 (`results`) ; erreur si le format a changé. */
export function records(json: unknown): Record<string, unknown>[] {
	const r = (json as { results?: unknown } | null)?.results;
	if (!Array.isArray(r)) throw new Error('Réponse illisible : « results » absent.');
	return r.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}

/** OK / KO / Inconnu (et variantes de casse, « En service », « Hors service »). */
export function parseState(v: unknown): EquipmentState {
	const s = text(v).toUpperCase();
	if (s === 'OK' || s === 'EN SERVICE') return 'ok';
	if (s === 'KO' || s === 'HORS SERVICE') return 'ko';
	return 'unknown';
}

const STATE_ORDER: Record<EquipmentState, number> = { ko: 0, unknown: 1, ok: 2 };

/**
 * Équipements d'une gare : ceux dont l'identifiant de gare vaut exactement `stationIds`
 * (le filtre du serveur est refait ici), sans doublon, hors service d'abord. Un enregistrement
 * sans nom ni localisation n'est pas affiché (on ne saurait pas de quel équipement il s'agit).
 */
export function parseEquipment(
	json: unknown,
	stationIds: readonly string[],
	stationField = SNCF.stationField
): OfficialEquipment[] {
	const out = new Map<string, OfficialEquipment>();
	for (const rec of records(json)) {
		const station = text(field(rec, (k) => k === stationField));
		if (!stationIds.includes(station)) continue;
		const name = text(field(rec, (k) => k === 'libelle' || k.startsWith('nom')));
		const location = text(field(rec, (k) => k.startsWith('localisation')));
		if (!name && !location) continue;
		const id =
			text(field(rec, (k) => k === 'id' || k.startsWith('id_equip'))) || `${name}|${location}`;
		if (out.has(id)) continue;
		out.set(id, {
			id,
			name,
			location,
			state: parseState(field(rec, (k) => k.startsWith('etat')))
		});
	}
	return [...out.values()].sort(
		(a, b) =>
			STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
			(a.name || a.location).localeCompare(b.name || b.location, 'fr', { numeric: true })
	);
}

/** Les 7 premiers chiffres d'un code UIC (« 87743005 » et « 8774300 » → « 8774300 »), ou ''. */
export const uic7 = (uic: string) => (/^\d{7,8}$/.test(uic.trim()) ? uic.trim().slice(0, 7) : '');

/**
 * Identifiants de gare (Id_Gare) du référentiel dont un code UIC commence par `uic` (7 chiffres).
 * Le code peut être un texte, un nombre ou une liste ; plusieurs codes dans un même texte sont
 * acceptés. Au plus 3 identifiants (une gare de l'index peut couvrir plusieurs gares SNCF).
 */
export function stationIdsFromUic(json: unknown, uic: string, idField = SNCF.stationsIdField) {
	const ids: string[] = [];
	for (const rec of records(json)) {
		const codes = JSON.stringify(field(rec, (k) => k.includes('uic')) ?? '').match(/\d{7,8}/g);
		if (!codes?.some((c) => c.startsWith(uic))) continue;
		const id = text(
			field(rec, (k) => k === idField),
			60
		);
		if (SAFE_ID.test(id) && !ids.includes(id)) ids.push(id);
	}
	return ids.slice(0, 3);
}

/** Identifiant admis dans une requête (pas de guillemet ni d'opérateur ODSQL). */
const SAFE_ID = /^[\w.-]{1,60}$/;

// ---------- Adaptateur SNCF Gares & Connexions (Opendatasoft Explore v2.1) ----------

export const SNCF = {
	statusDataset: 'etat-fonctionnement-elevatique-gare',
	stationsDataset: 'gares-de-voyageurs',
	/**
	 * Noms techniques vérifiés le 13/11/2026 sur des réponses réelles : la gare est `id` dans le
	 * référentiel et `gareid` dans le jeu d'état.
	 */
	stationField: 'gareid',
	stationsIdField: 'id',
	/** Une gare a au plus quelques dizaines d'équipements (Paris-Nord : 57 le 11/11/2026). */
	limit: 100
};

const recordsUrl = (origin: string, dataset: string, params: Record<string, string>) =>
	`${origin}/api/explore/v2.1/catalog/datasets/${dataset}/records?${new URLSearchParams(params)}`;

/** Requête du référentiel : recherche plein texte des 7 chiffres du code UIC. */
export const sncfStationsUrl = (origin: string, uic: string) =>
	recordsUrl(origin, SNCF.stationsDataset, { where: `search(*, "${uic}")`, limit: '20' });

/** Requête de l'état : équipements des gares `ids` seulement (jamais le jeu entier). */
export const sncfStatusUrl = (origin: string, ids: readonly string[]) =>
	recordsUrl(origin, SNCF.statusDataset, {
		where: ids.map((id) => `${SNCF.stationField}="${id}"`).join(' OR '),
		limit: String(SNCF.limit)
	});

export const sncfAdapter: StatusAdapter = {
	async read(station, source, get) {
		const uic = uic7(station.uic);
		if (!uic) return null;
		const ref = await get(sncfStationsUrl(source.origin, uic));
		const ids = stationIdsFromUic(ref.json, uic);
		if (!ids.length) return null;
		const st = await get(sncfStatusUrl(source.origin, ids));
		const equipment = parseEquipment(st.json, ids);
		if (!equipment.length) return null;
		return { equipment, at: Math.min(ref.at, st.at), stale: ref.stale || st.stale };
	}
};

export const ADAPTERS: Record<EquipmentStatusSource['adapter'], StatusAdapter> = {
	'sncf-gc': sncfAdapter
};

/**
 * Source à interroger pour une gare : celle de son pays, sauf si l'arrêt d'urgence de
 * config.json (`officialStatusEnabled: false`) coupe l'affichage. null : rien à lire ni afficher.
 */
export function statusSourceFor(
	country: unknown,
	cfg: Pick<RemoteConfig, 'officialStatusEnabled'>
): EquipmentStatusSource | null {
	return cfg.officialStatusEnabled ? countryConfig(country).equipmentStatus : null;
}

// ---------- Lecture avec cache en mémoire ----------

export interface StatusDeps {
	fetch: typeof fetch;
	now: () => number;
	cache: Map<string, { at: number; result: StatusResult }>;
}

/**
 * Lecture d'une URL de la source : sans cookie, sans adresse de page, JSON. Une réponse servie
 * par le service worker hors connexion porte l'en-tête STALE_HEADER (heure d'origine).
 */
export function jsonGetter(deps: Pick<StatusDeps, 'fetch' | 'now'>): GetJson {
	return async (url) => {
		const r = await deps.fetch(url, {
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			headers: { Accept: 'application/json' }
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const swAt = Number(r.headers.get(STALE_HEADER));
		return {
			json: await r.json(),
			at: swAt > 0 ? swAt : deps.now(),
			stale: swAt > 0
		};
	};
}

/**
 * État officiel d'une gare. `source` null (pays sans source) → none. Un résultat (même « none »)
 * est gardé 10 minutes en mémoire ; une erreur ne l'est pas. `force` ignore le cache.
 */
export async function readOfficialStatus(
	station: StatusStation & { id: string },
	source: EquipmentStatusSource | null,
	deps: StatusDeps,
	force = false
): Promise<StatusResult> {
	if (!source) return { kind: 'none' };
	const key = `${source.adapter}:${station.id}`;
	const hit = deps.cache.get(key);
	if (!force && hit && deps.now() - hit.at < MEMORY_TTL) return hit.result;
	let result: StatusResult;
	try {
		const r = await ADAPTERS[source.adapter].read(station, source, jsonGetter(deps));
		result = r
			? { kind: 'ok', status: { equipment: r.equipment, readAt: r.at, stale: r.stale } }
			: { kind: 'none' };
	} catch {
		deps.cache.delete(key);
		return { kind: 'error' };
	}
	// Une réponse de secours (hors connexion) n'est pas gardée : on réessaiera le réseau.
	if (!(result.kind === 'ok' && result.status.stale))
		deps.cache.set(key, { at: deps.now(), result });
	return result;
}

/** Compte des équipements par état (résumé de la section). */
export const countStates = (list: readonly OfficialEquipment[]) =>
	list.reduce((acc, e) => ((acc[e.state] += 1), acc), { ok: 0, ko: 0, unknown: 0 } as Record<
		EquipmentState,
		number
	>);
