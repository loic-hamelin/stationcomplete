// Configuration par pays (lot P1, architecture « Pays ») : tout ce qui change d'un pays à
// l'autre est ici, et nulle part ailleurs. Code pur, lu par l'appli, par vite.config.ts (CSP),
// par le service worker (cache des photos) et par les scripts de la CI (index des gares).
//
// Une gare appartient au pays de l'index d'où elle vient (static/data/stations-<cc>.json) :
// l'appli ne devine jamais le pays d'après la position. Les identifiants de gare sont les
// identifiants OSM (« n123 »), uniques dans le monde : ils ne portent pas le pays.
//
// Ajouter un pays : docs/architecture.md, section « Pays » (check-list).
//
// Ce fichier, stopsigns/ et csp.ts sont aussi chargés par Node sans outil de compilation
// (vite.config.ts, scripts/*.mjs) : imports avec l'extension .ts, et seulement du TypeScript
// « effaçable » (pas d'enum ni de namespace).

import type { BBox } from './osm.ts';
import { frStopSigns } from './stopsigns/fr.ts';
import type { StopSignSchema } from './stopsigns/types.ts';

export type CountryCode = 'fr' | 'ch';

/** Langues de l'interface prévues (traduction : lot suivant). */
export type Language = 'fr' | 'en' | 'de' | 'it' | 'es';

/**
 * Pays des données enregistrées avant le lot P1 (saisies, téléchargements sans champ `country`),
 * pays proposé par défaut, et pays des fonctions pures appelées sans pays.
 */
export const DEFAULT_COUNTRY: CountryCode = 'fr';

/** Photo aérienne d'un pays (tuiles raster Web Mercator). */
export interface Imagery {
	/** Identifiant stable (nom de la source). */
	id: string;
	/** Gabarit d'URL avec {z}, {x} et {y}. */
	tileUrl: string;
	tileSize: number;
	/** Zoom maximal servi (mesuré) ; au-delà, MapLibre agrandit. */
	maxZoom: number;
	/** Taille moyenne mesurée d'une tuile en gare, pour annoncer la taille d'un téléchargement. */
	avgTileBytes: number;
	/** Téléchargements simultanés au plus (politesse envers le fournisseur). */
	maxParallel: number;
	/** Origine des tuiles (CSP img-src/connect-src, cache du service worker). */
	origin: string;
	/** Mention affichée sur la carte. */
	attribution: string;
	/** Valeur du tag de changeset `imagery_used` quand la photo a servi. */
	imageryUsed: string;
	/** Pages À propos, Mentions légales et Données personnelles. */
	credit: {
		/** « IGN – BD ORTHO » */
		product: string;
		licence: string;
		licenceUrl: string;
		/** Service qui voit l'adresse IP (« IGN – Géoplateforme »). */
		operator: string;
		/** Pays du service (« France »). */
		operatorSeat: string;
	};
}

/** Construction de l'index des gares par la CI (scripts/build-stations.mjs, stations.yml). */
export interface StationIndexSource {
	/** Fichier publié, relatif à static/ (et à la racine du site). */
	file: string;
	/** Extrait Geofabrik, sans « -latest.osm.pbf » (« europe/france »). */
	geofabrik: string;
	/** Géocodage commune + subdivision (implémenté dans le script) ; '' = aucun. */
	geocoder: 'geo.api.gouv.fr' | '';
	/** Cache du géocodage, gardé dans le dépôt. */
	geocoderCache: string;
	/** Statistiques de construction, gardées dans le dépôt. */
	stats: string;
}

export interface Country {
	code: CountryCode;
	/** Pays proposé dans l'appli. Un pays désactivé n'est ni sélectionnable ni chargé. */
	enabled: boolean;
	/** Nom en français (clé de traduction au lot suivant). */
	name: string;
	/** « de France », « de Suisse » : complément de nom (« les gares de France »). */
	ofName: string;
	/** Emprise approximative [ouest, sud, est, nord] (contrôle de l'index). */
	bounds: BBox;
	index: StationIndexSource;
	/** null : pas encore de photo aérienne vérifiée (pays non activable). */
	imagery: Imagery | null;
	/** null : pas de schéma OSM établi, quêtes de pancartes désactivées dans ce pays. */
	stopSigns: StopSignSchema | null;
	/**
	 * Subdivision affichée avec la commune (département, canton) ; `names` : noms d'après le code
	 * de l'index (« 01 » → « Ain »), chargés à part (page « Choisir une gare » seulement).
	 */
	subdivision: {
		singular: string;
		plural: string;
		names?: () => Promise<{ default: Record<string, string> }>;
	};
	/**
	 * Fuseaux horaires du pays (Intl) : avec la région de la langue du téléphone, ils proposent
	 * le pays au premier lancement, sans localisation.
	 */
	timeZones: string[];
	/** Règles de quêtes propres au pays. */
	quests: {
		/** Q7 : numéro de voie écrit dans `name` ou `ref` d'une voie (« Voie 1 »). */
		misplacedTrackRef: RegExp;
	};
	/** Langues de l'interface proposées par défaut dans ce pays, la première d'abord. */
	languages: Language[];
	/** Équipements des quais (E7) : valeurs proposées en premier, propres au pays. */
	equipment: {
		/**
		 * Hauteurs de quai usuelles, en mètres au-dessus du rail (tag `height`), proposées en
		 * boutons ; « Autre » permet toujours une autre valeur.
		 */
		platformHeights: number[];
	};
}

const france: Country = {
	code: 'fr',
	enabled: true,
	name: 'France',
	ofName: 'de France',
	// Métropole et Corse (extrait Geofabrik « france ») : l'outre-mer n'est pas couvert.
	bounds: [-5.2, 41.3, 9.6, 51.1],
	index: {
		file: 'data/stations-fr.json',
		geofabrik: 'europe/france',
		geocoder: 'geo.api.gouv.fr',
		// Noms historiques (d'avant le lot P1), gardés pour ne pas perdre le cache du géocodage.
		geocoderCache: 'data/communes-cache.json',
		stats: 'data/stations-stats.json'
	},
	imagery: {
		id: 'ign-bdortho',
		// WMTS Géoplateforme, matrice PM (Web Mercator) : architecture § 6.1.
		tileUrl:
			'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
			'&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg' +
			'&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
		tileSize: 256,
		maxZoom: 19, // mesuré au lot 0a
		avgTileBytes: 16_000, // mesuré en gare (12 à 20 ko)
		maxParallel: 4, // service gratuit de l'IGN : on reste raisonnable
		origin: 'https://data.geopf.fr',
		attribution: 'Photo © IGN – BD ORTHO',
		imageryUsed: 'BDOrtho IGN',
		credit: {
			product: 'IGN – BD ORTHO',
			licence: 'Licence Ouverte 2.0',
			licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
			operator: 'IGN – Géoplateforme',
			operatorSeat: 'France'
		}
	},
	stopSigns: frStopSigns,
	subdivision: {
		singular: 'département',
		plural: 'départements',
		names: () => import('./subdivisions/fr.ts')
	},
	timeZones: ['Europe/Paris'],
	quests: { misplacedTrackRef: /^\s*(voie|v)\s*\w+/i },
	languages: ['fr'],
	// Hauteurs usuelles des quais en France : 0,55 m (standard européen), 0,76 m (ancienne
	// norme, encore courante), 0,92 m (RER et Transilien d'Île-de-France).
	equipment: { platformHeights: [0.55, 0.76, 0.92] }
};

// Suisse entière (décision de Loïc), pas encore activée. Seules les valeurs établies sont
// remplies ; le reste attend les vérifications de docs/pays/etude-suisse.md (§ 7.5).
const switzerland: Country = {
	code: 'ch',
	enabled: false,
	name: 'Suisse',
	ofName: 'de Suisse',
	// Extrémités du territoire (approximatives, à resserrer avec le polygone Geofabrik).
	bounds: [5.95, 45.81, 10.5, 47.81],
	index: {
		file: 'data/stations-ch.json',
		// TODO(lot P2) : extrait et polygone Geofabrik non vérifiés (étude § 2.1 et § 7.5),
		// découpage au polygone pour les gares frontalières (étude § 6.2, point 1).
		geofabrik: '',
		// TODO(lot P2) : canton par les limites OSM locales (étude § 6.2, point 2).
		geocoder: '',
		geocoderCache: 'data/communes-ch.json',
		stats: 'data/stations-stats-ch.json'
	},
	// TODO(lot P3) : SWISSIMAGE (étude § 1.2 et § 6.2, point 10) — CORS, zoom maximal en 3857,
	// poids moyen d'une tuile et valeur imagery_used (editor-layer-index) à vérifier d'abord.
	imagery: null,
	// TODO(lot P5) : schéma CH-FDV:577…580 (étude § 4), après l'avis du forum OSM suisse.
	stopSigns: null,
	subdivision: { singular: 'canton', plural: 'cantons' },
	timeZones: ['Europe/Zurich'],
	// Motifs « Gleis N », « voie N », « binario N » (étude § 6.2, point 10) ; usage non mesuré.
	quests: { misplacedTrackRef: /^\s*(gleis|voie|binario|v)\s*\w+/i },
	languages: ['de', 'fr', 'it'],
	// Suisse : 0,55 m est la hauteur standard (indication de Loïc, à confirmer à l'activation).
	equipment: { platformHeights: [0.55] }
};

export const COUNTRIES: Record<CountryCode, Country> = { fr: france, ch: switzerland };

/** Ce qui manque à un pays pour pouvoir être activé (vide : complet). */
export function countryProblems(c: Country): string[] {
	const out: string[] = [];
	if (!c.name || !c.ofName) out.push('nom');
	if (!c.index.file || !c.index.geofabrik) out.push('index des gares');
	if (!c.imagery) out.push('photo aérienne');
	else {
		const im = c.imagery;
		if (!/^https:\/\/[^/]+$/.test(im.origin)) out.push('origine de la photo');
		else if (!im.tileUrl.startsWith(im.origin + '/')) out.push('URL des tuiles hors origine');
		if (!['{z}', '{x}', '{y}'].every((p) => im.tileUrl.includes(p))) out.push('gabarit des tuiles');
		if (!(im.maxZoom > 0 && im.tileSize > 0 && im.avgTileBytes > 0 && im.maxParallel > 0))
			out.push('mesures de la photo');
		if (!im.attribution || !im.imageryUsed) out.push('attribution de la photo');
	}
	if (!c.languages.length) out.push('langues');
	// Pas de schéma de pancartes : permis (quêtes de pancartes désactivées).
	return out;
}

/** Pays activés et complets, dans l'ordre de déclaration. */
export const enabledCountries = (): Country[] =>
	Object.values(COUNTRIES).filter((c) => c.enabled && !countryProblems(c).length);

export const isCountryCode = (v: unknown): v is CountryCode =>
	typeof v === 'string' && Object.hasOwn(COUNTRIES, v);

/** Le pays peut-il être choisi (préférence) ou chargé ? */
export const isSelectable = (v: unknown): v is CountryCode =>
	isCountryCode(v) && enabledCountries().some((c) => c.code === v);

/** Pays sélectionnable correspondant à une valeur lue (préférence), sinon le pays par défaut. */
export const resolveCountry = (v: unknown): CountryCode => (isSelectable(v) ? v : DEFAULT_COUNTRY);

/**
 * Configuration d'un pays connu (activé ou non : une saisie déjà faite reste lisible).
 * Une valeur inconnue ou absente donne le pays par défaut.
 */
export const countryConfig = (code?: unknown): Country =>
	COUNTRIES[isCountryCode(code) ? code : DEFAULT_COUNTRY];

/**
 * Pays d'un enregistrement local (saisie, téléchargement, gare en cache). Les enregistrements
 * d'avant le lot P1 n'ont pas de champ `country` : ils sont français.
 */
export const recordCountry = (r: { country?: unknown } | undefined): CountryCode =>
	isCountryCode(r?.country) ? r.country : DEFAULT_COUNTRY;

/** Photo aérienne du pays ; erreur claire si le pays n'en a pas (pays non activable). */
export function imageryOf(code?: unknown): Imagery {
	const c = countryConfig(code);
	if (!c.imagery) throw new Error(`Pas de photo aérienne configurée pour le pays « ${c.code} ».`);
	return c.imagery;
}

/** Origines des photos aériennes des pays activés (CSP, service worker), sans doublon. */
export const imageryOrigins = (): string[] => [
	...new Set(enabledCountries().map((c) => c.imagery!.origin))
];

/** Mentions des photos aériennes des pays activés (pages légales), sans doublon. */
export const photoCredits = (): Imagery['credit'][] => [
	...new Map(enabledCountries().map((c) => [c.imagery!.id, c.imagery!.credit])).values()
];

/**
 * Pays proposé au premier lancement d'après le téléphone, sans localisation : fuseau horaire
 * (Intl), puis région des langues préférées (« fr-CH » → Suisse), sinon le pays par défaut.
 * Seuls les pays activés sont proposés (`candidates`, réglable pour les tests).
 */
export function detectCountry(
	env: { timeZone?: string; languages?: readonly string[] },
	candidates: Country[] = enabledCountries()
): CountryCode {
	const byZone = candidates.find((c) => env.timeZone && c.timeZones.includes(env.timeZone));
	if (byZone) return byZone.code;
	for (const tag of env.languages ?? []) {
		const region = String(tag).split(/[-_]/)[1]?.toLowerCase();
		const c = region && candidates.find((x) => x.code === region);
		if (c) return c.code;
	}
	return candidates.some((c) => c.code === DEFAULT_COUNTRY)
		? DEFAULT_COUNTRY
		: (candidates[0]?.code ?? DEFAULT_COUNTRY);
}
