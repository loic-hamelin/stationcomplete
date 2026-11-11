<script lang="ts">
	// Carte de placement fin (E6) : la croix reste au centre, la carte glisse dessous.
	// À chaque arrêt du déplacement, le point visé est accroché à l'axe de la voie la plus proche.
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { snapToTracks, type Snap } from '#lib/core/edits.js';
	import { metersPerPixel } from '#lib/core/draw.js';
	import {
		isPlatform,
		isUnderground,
		type OsmElement,
		type OsmNode,
		type OsmWay
	} from '#lib/core/osm.js';
	import type { Imagery } from '#lib/core/countries.js';
	import Reticle from './Reticle.svelte';
	import {
		IS_SEL,
		MAP,
		mapLocale,
		osmAttribution,
		QUAI_W,
		UNDER_CASING,
		UNDER_DASH,
		UNDER_LINE,
		VOIE_W,
		W,
		photoSource,
		plus
	} from './style.js';
	import { t } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	let {
		imagery,
		center,
		tracks,
		elements,
		onsnap,
		free = false,
		onmove
	}: {
		/** Photo aérienne du pays de la gare. */
		imagery: Imagery;
		center: [number, number];
		tracks: OsmWay[];
		elements: OsmElement[];
		onsnap: (s: Snap | undefined) => void;
		/** Placement libre (équipement) : pas d'accrochage, le point est le centre de la croix. */
		free?: boolean;
		onmove?: (lon: number, lat: number) => void;
	} = $props();

	let container: HTMLDivElement;
	let map: import('maplibre-gl').Map | undefined;
	let snapMarker: import('maplibre-gl').Marker | undefined;
	let failed = $state('');
	let snapped = $state(false);
	let snappedWay: number | undefined;

	const UNDER = ['==', ['get', 'under'], true] as import('maplibre-gl').ExpressionSpecification;
	const nodes = $derived(
		new Map(elements.filter((e): e is OsmNode => e.type === 'node').map((n) => [n.id, n]))
	);

	function geojson() {
		const line = (w: OsmWay) =>
			w.nodes
				.map((id) => nodes.get(id))
				.filter((n): n is OsmNode => !!n)
				.map((n) => [n.lon, n.lat]);
		const signs = elements.filter(
			(e): e is OsmNode =>
				e.type === 'node' && e.tags?.railway === 'signal' && !!e.tags['railway:signal:stop']
		);
		const platforms = elements.filter((e): e is OsmWay => e.type === 'way' && isPlatform(e.tags));
		return {
			type: 'FeatureCollection',
			features: [
				...platforms.map((w) => ({
					type: 'Feature',
					properties: { kind: 'quai', under: isUnderground(w.tags) },
					geometry: { type: 'LineString', coordinates: line(w) }
				})),
				...tracks.map((w) => ({
					type: 'Feature',
					id: w.id,
					properties: { kind: 'voie', under: isUnderground(w.tags) },
					geometry: { type: 'LineString', coordinates: line(w) }
				})),
				...signs.map((n) => ({
					type: 'Feature',
					properties: { kind: 'pancarte' },
					geometry: { type: 'Point', coordinates: [n.lon, n.lat] }
				}))
			]
		} as unknown as import('maplibre-gl').GeoJSONSourceSpecification['data'];
	}

	function update() {
		if (!map) return;
		const c = map.getCenter();
		if (free) {
			onmove?.(c.lng, c.lat);
			return;
		}
		const s = snapToTracks(c.lng, c.lat, tracks, (id) => nodes.get(id), 3);
		if (s) snapMarker?.setLngLat([s.lon, s.lat]).addTo(map);
		else snapMarker?.remove();
		// Voie accrochée : jaune avec halo (feature-state), croix jaune.
		if (snappedWay !== undefined && snappedWay !== s?.way)
			map.setFeatureState({ source: 'objets', id: snappedWay }, { selected: false });
		snappedWay = s?.way;
		if (s) map.setFeatureState({ source: 'objets', id: s.way }, { selected: true });
		snapped = !!s;
		onsnap(s);
	}

	/** Déplace la croix de `m` mètres (la carte glisse en sens inverse). */
	export function nudge(dx: number, dy: number, m = 0.2) {
		if (!map) return;
		const mpp = metersPerPixel(map.getZoom(), map.getCenter().lat);
		map.panBy([(dx * m) / mpp, (dy * m) / mpp], { duration: 0 });
	}
	export function zoom(d: number) {
		map?.zoomTo(map.getZoom() + d, { duration: 0 });
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			try {
				const lib = await import('maplibre-gl');
				lib.setWorkerUrl((await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')).default);
				if (disposed) return;
				map = new lib.Map({
					container,
					center,
					zoom: 19,
					maxZoom: 22,
					minZoom: 15,
					pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
					attributionControl: { compact: true },
					locale: mapLocale(),
					dragRotate: false,
					pitchWithRotate: false,
					touchPitch: false,
					fadeDuration: 0,
					style: {
						version: 8,
						sources: {
							photo: photoSource(imagery),
							objets: {
								type: 'geojson',
								data: geojson(),
								attribution: osmAttribution()
							}
						},
						layers: [
							{ id: 'fond', type: 'background', paint: { 'background-color': MAP.ground } },
							{ id: 'photo', type: 'raster', source: 'photo' },
							{
								id: 'quai-casing',
								type: 'line',
								source: 'objets',
								filter: ['==', ['get', 'kind'], 'quai'],
								layout: { 'line-join': 'round' },
								paint: {
									'line-color': MAP.casing,
									'line-opacity': ['case', UNDER, UNDER_CASING, 0.7],
									'line-width': W(plus(QUAI_W, 1.5))
								}
							},
							{
								id: 'quai',
								type: 'line',
								source: 'objets',
								filter: ['all', ['==', ['get', 'kind'], 'quai'], ['!', UNDER]],
								layout: { 'line-join': 'round' },
								paint: { 'line-color': MAP.quai, 'line-width': W(QUAI_W) }
							},
							// Souterrain : pointillés estompés (lot 7d).
							{
								id: 'quai-under',
								type: 'line',
								source: 'objets',
								filter: ['all', ['==', ['get', 'kind'], 'quai'], UNDER],
								paint: {
									'line-color': MAP.quai,
									'line-opacity': UNDER_LINE,
									'line-width': W(QUAI_W),
									'line-dasharray': UNDER_DASH
								}
							},
							{
								id: 'voie-sel',
								type: 'line',
								source: 'objets',
								filter: ['==', ['get', 'kind'], 'voie'],
								layout: { 'line-cap': 'round', 'line-join': 'round' },
								paint: {
									'line-color': MAP.sel,
									'line-opacity': ['case', IS_SEL, 0.35, 0],
									'line-width': W(plus(VOIE_W, 8))
								}
							},
							{
								id: 'voie-casing',
								type: 'line',
								source: 'objets',
								filter: ['==', ['get', 'kind'], 'voie'],
								layout: { 'line-cap': 'round', 'line-join': 'round' },
								paint: {
									'line-color': MAP.casing,
									'line-opacity': ['case', UNDER, UNDER_CASING, 0.7],
									'line-width': W(plus(VOIE_W, 1.5))
								}
							},
							{
								id: 'voie',
								type: 'line',
								source: 'objets',
								filter: ['all', ['==', ['get', 'kind'], 'voie'], ['!', UNDER]],
								layout: { 'line-cap': 'round', 'line-join': 'round' },
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, MAP.voie],
									'line-width': W(VOIE_W)
								}
							},
							{
								id: 'voie-under',
								type: 'line',
								source: 'objets',
								filter: ['all', ['==', ['get', 'kind'], 'voie'], UNDER],
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, MAP.voie],
									'line-opacity': ['case', IS_SEL, 1, UNDER_LINE],
									'line-width': W(VOIE_W),
									'line-dasharray': UNDER_DASH
								}
							},
							{
								id: 'pancarte',
								type: 'circle',
								source: 'objets',
								filter: ['==', ['get', 'kind'], 'pancarte'],
								paint: {
									'circle-radius': 4,
									'circle-color': MAP.plate,
									'circle-stroke-color': MAP.casing,
									'circle-stroke-width': 1.5
								}
							}
						]
					}
				});
				const el = document.createElement('div');
				el.className = 'rc-snap';
				snapMarker = new lib.Marker({ element: el });
				map.on('moveend', update);
				map.on('load', update);
			} catch (e) {
				failed = t('mapA11y.noWebgl');
				console.warn('[stationcomplete] carte :', e);
			}
		})();
		return () => {
			disposed = true;
			map?.remove();
		};
	});
</script>

<div class="wrap">
	<div class="map" bind:this={container} role="region" aria-label={t('mapA11y.placeMap')}></div>
	<Reticle {snapped} />
	{#if failed}<p class="failed" role="alert">{failed}</p>{/if}
</div>

<style>
	.wrap {
		position: relative;
		height: 100%;
		/* Contexte d'empilement propre : les repères MapLibre (z-index internes) restent sous
		   les menus flottants de la page, quel que soit leur z-index. */
		isolation: isolate;
	}
	.map {
		position: absolute;
		inset: 0;
		background: #8c877c;
	}
	.failed {
		position: absolute;
		inset: 40% 16px auto;
		padding: 14px;
		border-radius: var(--radius-lg);
		background: var(--bg);
	}
	/* Point d'accrochage sur l'axe de la voie : visible quand l'écart dépasse le centre de la croix. */
	:global(.rc-snap) {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #fff700;
		border: 1.5px solid #14110e;
	}
</style>
