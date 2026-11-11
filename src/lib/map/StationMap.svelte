<script lang="ts">
	// Carte d'une gare sur la photo aérienne du pays de la gare (MapLibre), style de la refonte v1.
	// Sobriété : MapLibre est chargé à la demande, rendu uniquement quand la vue change,
	// densité de pixels limitée à 2, aucune animation. Les étiquettes sont des boutons DOM
	// (accessibles au clavier et au lecteur d'écran), placées sans chevauchement à chaque moveend.
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { FeatureCollection, FeatureProps } from '#lib/core/features.js';
	import type { BBox } from '#lib/core/osm.js';
	import type { Imagery } from '#lib/core/countries.js';
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
		alongLine,
		avoidBoxes,
		placeLabels,
		plus,
		visiblePart
	} from './style.js';
	import { t } from '#lib/i18n/t.js';
	import { ICONS } from '#lib/icons.js';
	import { onMount, tick, untrack } from 'svelte';

	type Kind = FeatureProps['kind'];
	type F = FeatureCollection['features'][number];
	let {
		imagery,
		bbox,
		data,
		visible,
		focus,
		view,
		selected,
		onselect,
		onview
	}: {
		/** Photo aérienne du pays de la gare. */
		imagery: Imagery;
		bbox: BBox;
		data: FeatureCollection;
		visible: Record<Kind, boolean>;
		focus?: string;
		/** Vue de départ (centre, zoom) reprise d'un autre écran (retour de E12). */
		view?: { center: [number, number]; zoom: number };
		selected?: string;
		onselect: (p: FeatureProps | undefined) => void;
		/** Fin de chaque déplacement : centre et zoom (transmis à E12, qui les reprend). */
		onview?: (center: [number, number], zoom: number) => void;
	} = $props();

	let container: HTMLDivElement;
	let failed = $state('');
	let map: import('maplibre-gl').Map | undefined;
	let lib: typeof import('maplibre-gl') | undefined;
	type Label = {
		f: F;
		el: HTMLButtonElement;
		marker: import('maplibre-gl').Marker;
		w: number;
		h: number;
	};
	let labels: Label[] = [];
	let me: import('maplibre-gl').Marker | undefined;
	// Objets sélectionnés : plusieurs pour un quai en plusieurs parties (même `osm`).
	let selectedIds: number[] = [];

	type Expr = import('maplibre-gl').ExpressionSpecification;
	const isEdited: Expr = ['==', ['get', 'edited'], true];
	// Pointillés réservés aux objets souterrains (lot 7d) ; « à compléter » se lit sur l'étiquette.
	const under: Expr = ['==', ['get', 'under'], true];
	// Voie qui ne longe aucun quai (lot 7d) : même style, plus discrète.
	const away: Expr = ['==', ['get', 'away'], true];
	const kindIs = (k: Kind): Expr => ['==', ['get', 'kind'], k];

	function ringOf(f: F): [number, number][] {
		const g = f.geometry;
		return g.type === 'Point'
			? [g.coordinates]
			: g.type === 'LineString'
				? g.coordinates
				: g.coordinates[0];
	}

	/** Priorité d'affichage : sélectionné > quai alerte > quai > pancarte > voie alerte > voie à compléter > voie. */
	function rank(f: F) {
		const p = f.properties;
		if (p.osm === selected) return 0;
		if (p.kind === 'quai') return p.status === 'alert' ? 1 : 2;
		if (p.kind === 'pancarte' || p.kind === 'equip') return 3;
		return p.status === 'alert' ? 4 : p.status === 'missing' || p.edited ? 5 : 6;
	}

	/** L'étiquette est-elle affichée à ce zoom ? (z < 17 : seulement un point d'état). */
	function shownAt(f: F, z: number) {
		const p = f.properties;
		if (!visible[p.kind]) return false;
		if (p.osm === selected) return true;
		if (p.kind === 'pancarte') return z >= 18.5;
		if (p.kind === 'equip') return z >= 18;
		if (z < 17) return p.status !== 'ok' || !!p.edited;
		if (p.kind === 'quai' || z >= 18) return true;
		// 17 ≤ z < 18 : numéros de voie complets masqués sur la vue générale (décision 3).
		return p.status !== 'ok' || !!p.edited;
	}

	function candidates(f: F, view: { w: number; h: number }) {
		const pr = (c: [number, number]) => map!.project(c);
		const g = f.geometry;
		if (g.type === 'Point') return [pr(g.coordinates)];
		const pts = ringOf(f).map(pr);
		const fr = [0.5, 0.33, 0.67, 0.2, 0.8, 0.1, 0.9];
		if (g.type === 'Polygon') {
			// Quai surfacique : centre, puis le long de son grand axe.
			let a = pts[0],
				b = pts[0],
				d = -1;
			for (const p of pts)
				for (const q of pts) {
					const n = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
					if (n > d) [a, b, d] = [p, q, n];
				}
			return alongLine([a, b], fr);
		}
		const first = f.anchor ? [pr(f.anchor)] : [];
		return [...first, ...alongLine(visiblePart(pts, view), fr)];
	}

	/** Place les étiquettes visibles sans chevauchement (au moveend seulement, pas pendant le geste). */
	function layout() {
		if (!map || !labels.length) return;
		const z = map.getZoom();
		const view = { w: container.clientWidth, h: container.clientHeight };
		const far = z < 17;
		container.classList.toggle('rc-far', far);
		const active = labels.filter((l) => shownAt(l.f, z)).sort((a, b) => rank(a.f) - rank(b.f));
		const cand = active.map((l) => ({
			w: far && l.f.properties.osm !== selected ? 16 : l.w,
			h: l.h,
			points: candidates(l.f, view)
		}));
		const pick = placeLabels(cand, view, avoidBoxes(container));
		for (const l of labels) l.el.hidden = true;
		active.forEach((l, i) => {
			if (pick[i] < 0) return;
			const p = cand[i].points[pick[i]];
			l.el.hidden = false;
			if (l.f.geometry.type !== 'Point') l.marker.setLngLat(map!.unproject([p.x, p.y]));
		});
	}
	let pendingLayout = 0;
	const relayout = () => {
		cancelAnimationFrame(pendingLayout);
		pendingLayout = requestAnimationFrame(layout);
	};

	function addLabels() {
		if (!map || !lib) return;
		for (const l of labels) l.marker.remove();
		labels = [];
		for (const f of data.features) {
			const p = f.properties;
			// Voie sans numéro qui ne longe aucun quai : pas d'étiquette (touchable sur son trait).
			if (!p.label) continue;
			const el = document.createElement('button');
			el.type = 'button';
			const state = p.status === 'missing' ? 'todo' : p.status;
			el.className = `rc-badge ${p.kind} ${state}${p.edited ? ' edited' : ''}${p.label === '?' ? ' unknown' : ''}`;
			const span = document.createElement('span');
			// Équipement : icône du jeu maison (ascenseur, distributeur), nommée par aria-label.
			if (p.kind === 'equip' && p.sub)
				span.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[p.sub]}</svg>`;
			else span.textContent = p.label;
			el.append(span);
			el.setAttribute('aria-label', `${p.title}. ${p.detail}`);
			el.setAttribute('aria-pressed', String(p.osm === selected));
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				onselect(p);
			});
			const marker = new lib.Marker({
				element: el,
				anchor: p.kind === 'pancarte' ? 'bottom' : 'center'
			})
				.setLngLat(
					f.geometry.type === 'Point' ? f.geometry.coordinates : (f.anchor ?? ringOf(f)[0])
				)
				.addTo(map);
			// Mesure une fois la taille du visuel (pour l'évitement des collisions).
			labels.push({ f, el, marker, w: span.offsetWidth || 24, h: span.offsetHeight || 18 });
		}
		applyVisibility();
	}

	function applyVisibility() {
		if (!map?.getLayer('pancarte')) return;
		const layers: Record<Kind, string[]> = {
			quai: ['quai-sel', 'quai-fill', 'quai-casing', 'quai-line', 'quai-line-under'],
			voie: ['voie-sel', 'voie-casing', 'voie-line', 'voie-line-under'],
			pancarte: ['pancarte'],
			equip: ['equip', 'equip-casing', 'equip-line', 'equip-arrow']
		};
		for (const k of Object.keys(layers) as Kind[])
			for (const id of layers[k])
				map.setLayoutProperty(id, 'visibility', visible[k] ? 'visible' : 'none');
		relayout();
	}

	/** Replace les étiquettes (la feuille basse a changé de hauteur). */
	export function refreshLabels() {
		tick().then(relayout);
	}

	export function locate() {
		if (!('geolocation' in navigator) || !map || !lib) return;
		navigator.geolocation.getCurrentPosition(
			(p) => {
				if (!map || !lib) return;
				const ll: [number, number] = [p.coords.longitude, p.coords.latitude];
				if (!me) {
					const el = document.createElement('div');
					el.className = 'rc-me';
					el.setAttribute('role', 'img');
					el.setAttribute('aria-label', t('mapA11y.myPosition'));
					me = new lib.Marker({ element: el });
				}
				me.setLngLat(ll).addTo(map);
				map.jumpTo({ center: ll });
			},
			() => {},
			{ enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
		);
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			try {
				lib = await import('maplibre-gl');
				const workerUrl = (await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')).default;
				lib.setWorkerUrl(workerUrl);
				if (disposed) return;
				const line = { 'line-join': 'round', 'line-cap': 'round' } as const;
				map = new lib.Map({
					container,
					bounds: bbox,
					fitBoundsOptions: { padding: 40 },
					maxZoom: 21,
					minZoom: 12,
					pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
					attributionControl: { compact: true },
					locale: mapLocale(),
					dragRotate: false,
					pitchWithRotate: false,
					fadeDuration: 0,
					style: {
						version: 8,
						sources: {
							photo: photoSource(imagery),
							gare: {
								type: 'geojson',
								data: data as unknown as import('maplibre-gl').GeoJSONSourceSpecification['data'],
								attribution: osmAttribution()
							}
						},
						layers: [
							{ id: 'fond', type: 'background', paint: { 'background-color': MAP.ground } },
							{ id: 'photo', type: 'raster', source: 'photo' },
							// Quais : contour fin clair sur liseré sombre, remplissage léger.
							{
								id: 'quai-sel',
								type: 'line',
								source: 'gare',
								filter: kindIs('quai'),
								layout: line,
								paint: {
									'line-color': MAP.sel,
									'line-opacity': ['case', IS_SEL, 0.28, 0],
									'line-width': W(plus(QUAI_W, 7))
								}
							},
							{
								id: 'quai-fill',
								type: 'fill',
								source: 'gare',
								filter: ['all', kindIs('quai'), ['==', ['geometry-type'], 'Polygon']],
								paint: {
									'fill-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.quai],
									'fill-opacity': [
										'step',
										['zoom'],
										['case', IS_SEL, 0.18, under, 0.08, 0.16],
										18,
										['case', IS_SEL, 0.18, under, 0.05, 0.1]
									]
								}
							},
							{
								id: 'quai-casing',
								type: 'line',
								source: 'gare',
								filter: kindIs('quai'),
								layout: line,
								paint: {
									'line-color': MAP.casing,
									'line-opacity': ['case', under, UNDER_CASING, 0.7],
									'line-width': W(plus(QUAI_W, 1.5))
								}
							},
							{
								id: 'quai-line',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('quai'), ['!', under]],
								layout: line,
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.quai],
									'line-width': W(QUAI_W)
								}
							},
							// Souterrain : pointillés estompés (sélection et « modifié » restent lisibles).
							{
								id: 'quai-line-under',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('quai'), under],
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.quai],
									'line-opacity': ['case', IS_SEL, 1, UNDER_LINE],
									'line-width': W(QUAI_W),
									'line-dasharray': UNDER_DASH
								}
							},
							// Voies : trait clair sur liseré sombre ; pointillés estompés = souterrain.
							{
								id: 'voie-sel',
								type: 'line',
								source: 'gare',
								filter: kindIs('voie'),
								layout: line,
								paint: {
									'line-color': MAP.sel,
									'line-opacity': ['case', IS_SEL, 0.35, 0],
									'line-width': W(plus(VOIE_W, 8))
								}
							},
							{
								id: 'voie-casing',
								type: 'line',
								source: 'gare',
								filter: kindIs('voie'),
								layout: line,
								paint: {
									'line-color': MAP.casing,
									'line-opacity': ['case', under, UNDER_CASING, away, 0.4, 0.7],
									'line-width': W(plus(VOIE_W, 1.5))
								}
							},
							{
								id: 'voie-line',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('voie'), ['!', under]],
								layout: line,
								paint: {
									'line-opacity': ['case', IS_SEL, 1, away, 0.55, 1],
									'line-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.voie],
									'line-width': W(VOIE_W)
								}
							},
							{
								id: 'voie-line-under',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('voie'), under],
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.voie],
									'line-opacity': ['case', IS_SEL, 1, UNDER_LINE],
									'line-width': W(VOIE_W),
									'line-dasharray': UNDER_DASH
								}
							},
							// Escaliers (étape 3) : trait fin bleu pâle sur liseré, flèche vers le haut (ou
							// sens de marche) quand il est connu ; pointillés estompés si souterrain.
							{
								id: 'equip-casing',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('equip'), ['==', ['geometry-type'], 'LineString']],
								layout: line,
								paint: {
									'line-color': MAP.casing,
									'line-opacity': ['case', under, UNDER_CASING, 0.7],
									'line-width': W(plus(QUAI_W, 2.5))
								}
							},
							{
								id: 'equip-line',
								type: 'line',
								source: 'gare',
								filter: ['all', kindIs('equip'), ['==', ['geometry-type'], 'LineString']],
								layout: line,
								paint: {
									'line-color': ['case', IS_SEL, MAP.sel, isEdited, MAP.edited, MAP.equip],
									'line-opacity': ['case', IS_SEL, 1, under, UNDER_LINE, 1],
									'line-width': W(plus(QUAI_W, 1))
								}
							},
							{
								id: 'equip-arrow',
								type: 'symbol',
								source: 'gare',
								filter: ['all', kindIs('equip'), ['has', 'arrow']],
								minzoom: 17.5,
								layout: {
									'symbol-placement': 'line-center',
									'icon-image': 'rc-arrow',
									'icon-rotation-alignment': 'map',
									'icon-allow-overlap': true,
									'icon-ignore-placement': true,
									'icon-rotate': ['case', ['==', ['get', 'arrow'], 'backward'], 180, 0]
								}
							},
							// Équipements sous z18 : petit rond bleu pâle (étiquette à icône au-delà).
							{
								id: 'equip',
								type: 'circle',
								source: 'gare',
								filter: ['all', kindIs('equip'), ['==', ['geometry-type'], 'Point']],
								maxzoom: 18,
								paint: {
									'circle-radius': 3.5,
									'circle-color': ['case', IS_SEL, MAP.sel, MAP.equip],
									'circle-stroke-color': MAP.casing,
									'circle-stroke-width': 1
								}
							},
							// Pancartes sous z18,5 : petit rond blanc (la plaque est un marqueur DOM au-delà).
							{
								id: 'pancarte',
								type: 'circle',
								source: 'gare',
								filter: kindIs('pancarte'),
								maxzoom: 18.5,
								paint: {
									'circle-radius': 3.5,
									'circle-color': ['case', IS_SEL, MAP.sel, MAP.plate],
									'circle-stroke-color': MAP.casing,
									'circle-stroke-width': 1
								}
							}
						]
					}
				});
				// Flèche des escaliers, dessinée ici (aucune ressource externe) : pointe vers la droite,
				// c'est-à-dire dans le sens de la ligne.
				map.on('styleimagemissing', (e) => {
					if (e.id === 'rc-arrow' && !map!.hasImage('rc-arrow'))
						map!.addImage('rc-arrow', arrowImage(), { pixelRatio: 2 });
				});
				map.on('error', (e) => console.warn('[stationcomplete] carte :', e.error?.message));
				map.on('moveend', relayout);
				// Vue courante : exposée (data-center, data-zoom) et transmise à la page.
				map.on('moveend', () => {
					const c = map!.getCenter(),
						z = map!.getZoom();
					container.dataset.center = `${c.lng.toFixed(7)},${c.lat.toFixed(7)}`;
					container.dataset.zoom = z.toFixed(2);
					onview?.([c.lng, c.lat], z);
				});
				map.on('resize', relayout);
				map.on('load', () => {
					addLabels();
					// (Une partie d'un quai en plusieurs parties désigne le quai entier.)
					const f = focus
						? data.features.find((x) => x.properties.osm === focus || x.properties.part === focus)
						: undefined;
					// Vue reprise (retour de E12) : exactement celle de l'utilisateur.
					if (view) map!.jumpTo({ center: view.center, zoom: view.zoom });
					if (f) {
						if (!view) map!.jumpTo({ center: f.anchor ?? centerOf(f), zoom: 18.5 });
						onselect(f.properties);
					} else if (!view) map!.fitBounds(bbox, { padding: 32, maxZoom: 19, duration: 0 });
					// (moveend initial : la vue est publiée même si rien n'a bougé.)
					map!.fire('moveend');
					highlight();
					relayout();
				});
				// Toucher un trait sélectionne l'objet, même si son étiquette est masquée.
				map.on('click', (e) => {
					const r = 12;
					const hits = map!.queryRenderedFeatures(
						[
							[e.point.x - r, e.point.y - r],
							[e.point.x + r, e.point.y + r]
						],
						{
							layers: [
								'equip',
								'equip-line',
								'pancarte',
								'voie-line',
								'voie-line-under',
								'quai-line',
								'quai-line-under',
								'quai-fill'
							].filter((id) => map!.getLayoutProperty(id, 'visibility') !== 'none')
						}
					);
					const hit = hits.length ? data.features.find((x) => x.id === hits[0].id) : undefined;
					onselect(hit?.properties);
				});
			} catch (e) {
				failed = t('mapA11y.noWebglList');
				console.warn('[stationcomplete] carte :', e);
			}
		})();
		return () => {
			disposed = true;
			cancelAnimationFrame(pendingLayout);
			map?.remove();
		};
	});

	function arrowImage() {
		const c = document.createElement('canvas');
		c.width = c.height = 28;
		const g = c.getContext('2d')!;
		g.lineJoin = 'round';
		g.beginPath();
		g.moveTo(6, 6);
		g.lineTo(22, 14);
		g.lineTo(6, 22);
		g.lineTo(10, 14);
		g.closePath();
		g.fillStyle = MAP.casing;
		g.strokeStyle = '#ffffff';
		g.lineWidth = 2;
		g.stroke();
		g.fill();
		return g.getImageData(0, 0, 28, 28);
	}

	function centerOf(f: F): [number, number] {
		const pts = ringOf(f);
		if (f.geometry.type === 'LineString') return pts[Math.floor(pts.length / 2)];
		const xs = pts.map((p) => p[0]),
			ys = pts.map((p) => p[1]);
		return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
	}

	/** Sélection : état de l'objet (feature-state) et étiquette pressée, sans recréer la source. */
	function highlight() {
		for (const l of labels) {
			const on = l.f.properties.osm === selected;
			l.el.setAttribute('aria-pressed', String(on));
			l.marker.getElement().style.zIndex = on ? '2' : '';
		}
		if (!map?.getSource('gare')) return;
		for (const id of selectedIds) map.setFeatureState({ source: 'gare', id }, { selected: false });
		// Quai en plusieurs parties : toutes ses parties prennent la couleur de sélection.
		selectedIds = selected
			? data.features.filter((x) => x.properties.osm === selected).map((x) => x.id)
			: [];
		for (const id of selectedIds) map.setFeatureState({ source: 'gare', id }, { selected: true });
	}

	// Saisie faite sans quitter la carte (suppression d'un quai, lot 7) : on met à jour la
	// source et les étiquettes, sans recréer la carte.
	let shownData: FeatureCollection | undefined = untrack(() => data);
	$effect(() => {
		const d = data;
		if (d === shownData || !map?.getSource('gare')) return;
		shownData = d;
		(map.getSource('gare') as import('maplibre-gl').GeoJSONSource).setData(
			d as unknown as import('maplibre-gl').GeoJSONSourceSpecification['data']
		);
		selectedIds = [];
		addLabels();
		highlight();
	});

	$effect(() => {
		void selected;
		highlight();
		// La feuille basse change la place libre : on replace les étiquettes après son affichage.
		tick().then(relayout);
	});

	$effect(() => {
		// Réagit aux filtres Quais / Voies / Pancartes.
		void visible.quai;
		void visible.voie;
		void visible.pancarte;
		void visible.equip;
		applyVisibility();
	});
</script>

<div class="map" bind:this={container} role="region" aria-label={t('mapA11y.stationMap')}>
	{#if failed}<p class="failed" role="alert">{failed}</p>{/if}
</div>

<style>
	.map {
		position: absolute;
		inset: 0;
		background: #8c877c;
		/* Repères MapLibre confinés sous les menus flottants (voir DrawMap). */
		isolation: isolate;
	}
	.failed {
		position: absolute;
		inset: 40% 16px auto;
		padding: 16px;
		border-radius: var(--radius-lg);
		background: var(--bg);
		color: var(--text);
	}
	/* Étiquettes de carte : pastille de 18 px, zone tactile de 24 px de haut au moins (WCAG 2.5.8). */
	:global(.rc-badge) {
		min-width: 24px;
		min-height: 24px;
		padding: 3px 0;
		border: 0;
		background: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	:global(.rc-badge[hidden]) {
		display: none;
	}
	:global(.rc-badge > span) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 18px;
		padding: 0 5px;
		border-radius: 2px;
		background: rgb(31 27 23 / 0.86);
		box-shadow: 0 0 0 0.75px rgb(255 255 255 / 0.55);
		color: #fff;
		font: 600 11px/1 var(--font);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	:global(.rc-badge.voie > span) {
		border-radius: 9px;
	}
	:global(.rc-badge.unknown > span) {
		color: #ffe08a;
	}
	/* Alerte : pastille rouge portant « ! » (forme + signe, pas seulement la couleur). */
	:global(.rc-badge.alert > span::before) {
		content: '!';
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #ff6a5c;
		color: #1f1b17;
		font-size: 9px;
	}
	/* Modifié par vous, en attente d'envoi : point bleu pâle (rond, sans signe). */
	:global(.rc-badge.edited > span::after) {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #b3c8ff;
		order: -1;
	}
	:global(.rc-badge[aria-pressed='true'] > span) {
		background: #fff700;
		color: #1f1b17;
		box-shadow: 0 0 0 1px #14110e;
	}
	:global(.rc-badge[aria-pressed='true'].edited > span::after) {
		background: #1844ef;
	}
	/* Pancarte au-delà de z18,5 : plaque blanche à filet sombre, sur un mât de 12 px. */
	:global(.rc-badge.pancarte) {
		flex-direction: column;
		padding: 0;
	}
	:global(.rc-badge.pancarte > span) {
		height: 16px;
		padding: 0 4px;
		border-radius: 1px;
		background: #fff;
		color: #1f1b17;
		box-shadow: 0 0 0 1px #14110e;
		font-size: 10px;
	}
	/* Équipement : pastille claire à icône fine (ascenseur, distributeur). */
	:global(.rc-badge.equip > span) {
		height: 20px;
		padding: 0 3px;
		border-radius: 4px;
		background: #fff;
		color: #1f1b17;
		box-shadow: 0 0 0 1px #14110e;
	}
	:global(.rc-badge.equip.todo > span) {
		box-shadow:
			0 0 0 1px #14110e,
			0 0 0 3px #ffe08a;
	}
	:global(.rc-badge.pancarte::after) {
		content: '';
		width: 1.5px;
		height: 12px;
		background: #14110e;
	}
	/* Vue d'ensemble (z < 17) : un point d'état seulement (« ! », « ? » ou point bleu). */
	:global(.rc-far .rc-badge:not([aria-pressed='true']) > span) {
		width: 14px;
		height: 14px;
		padding: 0;
		justify-content: center;
		border-radius: 50%;
		font-size: 0;
		gap: 0;
	}
	:global(.rc-far .rc-badge.todo:not(.alert):not([aria-pressed='true']) > span::before) {
		content: '?';
		color: #ffe08a;
		font-size: 10px;
	}
	:global(.rc-far .rc-badge.alert:not([aria-pressed='true']) > span::after),
	:global(.rc-far .rc-badge.todo:not([aria-pressed='true']) > span::after) {
		display: none;
	}
	:global(.rc-me) {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #1844ef;
		border: 2px solid #fff;
		box-shadow: 0 0 0 5px rgb(24 68 239 / 0.25);
	}
</style>
