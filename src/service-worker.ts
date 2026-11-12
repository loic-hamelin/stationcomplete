/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Service worker de stationcomplete : met en cache l'« enveloppe » de l'appli (pages, scripts,
// styles, polices, icônes) pour qu'elle s'ouvre sans réseau (lot 0b), et sert les photos
// aériennes des gares téléchargées (lot 4). Les données OSM sont dans IndexedDB. L'état officiel
// des ascenseurs (D4 bis) passe par le réseau d'abord ; hors connexion, la dernière réponse est
// servie quelques heures au plus, avec son heure, puis oubliée.

import { assets, immutable, prerendered } from '$app/manifest';
import { version } from '$app/env';
import { equipmentStatusOrigins, imageryOrigins } from '#lib/core/countries.js';
import { OFFLINE_MAX_AGE, STALE_HEADER } from '#lib/core/officialStatus.js';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `app-${version}`;
/** Tuiles des gares téléchargées : conservées d'une version de l'appli à l'autre. */
const TILES = 'rc-tiles';
/** Fournisseurs de photos aériennes des pays activés (configuration des pays). */
const PHOTOS = new Set(imageryOrigins());
/** État officiel des équipements (D4 bis) : réponses gardées OFFLINE_MAX_AGE au plus. */
const STATUS = 'rc-status';
const STATUS_ORIGINS = new Set(equipmentStatusOrigins());
// Les chemins du manifeste sont relatifs à la racine du site : on les rend absolus (« /… »).
const toPath = (p: string) => new URL(p, sw.location.origin + '/').pathname;
const ASSETS = [...immutable, ...assets, ...prerendered]
	.map(({ path }) => toPath(path))
	// Les anciennes polices .woff ne servent qu'aux navigateurs trop vieux pour l'appli.
	.filter((p) => !p.endsWith('.woff') && !p.endsWith('/CNAME'));
// Fichiers dont le nom change à chaque version : servis depuis le cache sans vérification.
// Les pages HTML et les données (index des gares) passent par le réseau d'abord,
// pour que chaque nouvelle version soit visible dès la visite suivante.
const IMMUTABLE = new Set(
	[...immutable, ...assets]
		.map(({ path }) => toPath(path))
		.filter((p) => !p.endsWith('.json') && !p.endsWith('.webmanifest'))
);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	// Supprime les caches des versions précédentes.
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	// Photo aérienne : depuis les gares téléchargées si possible, sinon le réseau (sans stocker,
	// pour que le cache ne grossisse pas en simple consultation).
	if (PHOTOS.has(url.origin)) {
		event.respondWith(
			(async () => {
				const hit = await (await caches.open(TILES)).match(request.url);
				return hit ?? fetch(request);
			})()
		);
		return;
	}
	if (STATUS_ORIGINS.has(url.origin)) {
		event.respondWith(officialStatus(request));
		return;
	}
	// Seules les ressources du site passent par le cache de l'appli (pas l'API OSM).
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Fichiers versionnés de l'appli : toujours depuis le cache.
			if (IMMUTABLE.has(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}
			// Le reste : réseau d'abord, cache en secours, puis page d'accueil hors-ligne.
			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') cache.put(request, response.clone());
				return response;
			} catch {
				const cached =
					(await cache.match(request, { ignoreSearch: request.mode === 'navigate' })) ??
					(request.mode === 'navigate' ? await cache.match('/') : undefined);
				if (cached) return cached;
				return new Response('Hors-ligne', { status: 503, statusText: 'Hors-ligne' });
			}
		})()
	);
});

/**
 * État officiel : réseau d'abord. Une réponse valide est gardée avec son heure (en-tête
 * STALE_HEADER, posé seulement sur la copie du cache) ; hors connexion, elle est servie si elle a
 * moins de OFFLINE_MAX_AGE, sinon effacée. Les réponses trop vieilles sont purgées à chaque passage.
 */
async function officialStatus(request: Request): Promise<Response> {
	const cache = await caches.open(STATUS);
	const now = Date.now();
	const age = (r: Response) => now - Number(r.headers.get(STALE_HEADER) ?? 0);
	for (const key of await cache.keys()) {
		const r = await cache.match(key);
		if (!r || age(r) > OFFLINE_MAX_AGE) await cache.delete(key);
	}
	try {
		const response = await fetch(request);
		if (response.ok) {
			const headers = new Headers({
				'content-type': response.headers.get('content-type') ?? 'application/json',
				[STALE_HEADER]: String(now)
			});
			await cache.put(request.url, new Response(await response.clone().blob(), { headers }));
		}
		return response;
	} catch (e) {
		const hit = await cache.match(request.url);
		if (hit && age(hit) <= OFFLINE_MAX_AGE) return hit;
		throw e;
	}
}
