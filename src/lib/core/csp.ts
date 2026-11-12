// Politique de sécurité du contenu (architecture § 8.1), générée depuis la configuration des
// pays : les origines des photos aériennes des pays activés sont ajoutées à img-src et
// connect-src ; celles des sources d'état officiel des équipements (D4 bis), à connect-src
// seulement (liste fermée d'hôtes exacts, lecture seule). Lue par vite.config.ts (SvelteKit l'écrit dans une balise <meta> de chaque page).
// Code pur, chargeable par Node sans outil (imports avec extension .ts, comme countries.ts).

import type { Config } from '@sveltejs/kit/vite';
import { equipmentStatusOrigins, imageryOrigins } from './countries.ts';

type Directives = NonNullable<NonNullable<Config['csp']>['directives']>;
type Sources = NonNullable<Directives['img-src']>;

/** Serveurs OpenStreetMap joints par l'appli (lecture, connexion OAuth2, envoi). */
export const OSM_ORIGINS: Sources = [
	'https://api.openstreetmap.org',
	'https://www.openstreetmap.org',
	'https://master.apis.dev.openstreetmap.org'
];

export function cspDirectives(
	imagery: string[] = imageryOrigins(),
	equipmentStatus: string[] = equipmentStatusOrigins()
): Directives {
	// Origines « https://hôte » contrôlées par countryProblems() (countries.ts).
	const photos = imagery as Sources;
	const status = equipmentStatus as Sources;
	return {
		'default-src': ['self'],
		'script-src': ['self'],
		'style-src': ['self', 'unsafe-inline'],
		'img-src': ['self', 'data:', 'blob:', ...photos],
		'font-src': ['self'],
		'connect-src': ['self', ...OSM_ORIGINS, ...photos, ...status],
		'worker-src': ['self', 'blob:'],
		'manifest-src': ['self'],
		'base-uri': ['self'],
		'form-action': ['self'],
		'object-src': ['none']
	};
}
