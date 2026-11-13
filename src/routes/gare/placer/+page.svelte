<script lang="ts">
	// E6 — Placement fin d'une pancarte d'arrêt sur l'axe de la voie (rapport tags § 3.5).
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import type { Snap } from '#lib/core/edits.js';
	import { countryConfig, imageryOf } from '#lib/core/countries.js';
	import { isRail, type OsmNode, type OsmWay } from '#lib/core/osm.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, pending } from '#lib/edits.svelte.js';
	import NudgePad from '#lib/map/NudgePad.svelte';
	import PlacementMap from '#lib/map/PlacementMap.svelte';
	import { distanceM } from '#lib/stations.js';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtDecimal, t } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
	});
	const q = $derived(mounted ? page.url.searchParams : new URLSearchParams());
	const id = $derived(q.get('id') ?? '');
	$effect(() => {
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});

	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	// Pancartes reconnues selon le schéma du pays de la gare.
	const signs = $derived(ready ? countryConfig(ready.station.country).stopSigns : null);
	// Voies candidates : toutes les voies ferrées chargées pour la gare.
	const tracks = $derived(
		(view?.elements ?? []).filter((e): e is OsmWay => e.type === 'way' && isRail(e.tags))
	);
	// Départ : la voie choisie sur la carte, sinon le centre de la gare.
	const start = $derived.by((): [number, number] | undefined => {
		if (!ready) return undefined;
		const lon = Number(q.get('lon')),
			lat = Number(q.get('lat'));
		if (lon && lat) return [lon, lat];
		return [ready.station.lon, ready.station.lat];
	});

	// Équipement (lot Équipements) : placement libre, sans accrochage à la voie.
	const equipKind = $derived(
		q.get('kind') === 'elevator' || q.get('kind') === 'ticket'
			? (q.get('kind') as 'elevator' | 'ticket')
			: undefined
	);
	let free = $state<[number, number] | undefined>();
	function goEquip() {
		if (!free || !equipKind) return;
		goto(
			resolve(
				`/gare/equipement?id=${encodeURIComponent(id)}&kind=${equipKind}&lon=${free[0].toFixed(7)}&lat=${free[1].toFixed(7)}`
			)
		);
	}
	let snap = $state<Snap | undefined>();
	let near = $state<OsmNode | undefined>();
	let mapRef = $state<{ nudge: (dx: number, dy: number) => void; zoom: (d: number) => void }>();

	function validate() {
		if (!snap || !view) return;
		// Une pancarte existe déjà à moins de 10 m sur la même voie ? On propose de la modifier.
		const w = view.elements.find((e) => e.type === 'way' && e.id === snap!.way) as OsmWay;
		const existing = view.elements.find(
			(e): e is OsmNode =>
				e.type === 'node' &&
				!!signs?.isStopSign(e.tags) &&
				w.nodes.includes(e.id) &&
				distanceM(e.lat, e.lon, snap!.lat, snap!.lon) < 10
		);
		if (existing && !near) {
			near = existing;
			return;
		}
		go();
	}
	function go() {
		if (!snap) return;
		const p = new URLSearchParams({
			id,
			way: String(snap.way),
			after: String(snap.after),
			lon: snap.lon.toFixed(7),
			lat: snap.lat.toFixed(7),
			bearing: snap.bearing.toFixed(0)
		});
		goto(resolve(`/gare/saisie?${p}`));
	}
</script>

<svelte:head><title>{t('place.title')}</title></svelte:head>

<!-- Carte plein écran ; en-tête, contrôles et actions flottent au-dessus (décision 6). -->
<div class="screen">
	<div class="mapbox">
		{#if view && start && ready}
			<PlacementMap
				bind:this={mapRef}
				imagery={imageryOf(ready.station.country)}
				center={start}
				{tracks}
				elements={view.elements}
				free={!!equipKind}
				onmove={(lon, lat) => (free = [lon, lat])}
				onsnap={(s) => ((snap = s), (near = undefined))}
			/>
		{:else}
			<p class="status float" role="status">{t('common.loading')}</p>
		{/if}
	</div>

	<div class="stack">
		<header class="top float">
			<div class="row">
				<a
					class="icon-btn"
					href={resolve(`/gare/carte?id=${encodeURIComponent(id)}`)}
					aria-label={t('common.cancel')}><Icon name="close" size={22} /></a
				>
				<h1>
					{equipKind
						? t('place.equipHeading', {
								label: t(equipKind === 'elevator' ? 'equip.kind.elevator' : 'equip.kind.ticket')
							})
						: t('place.heading')}
				</h1>
			</div>
			<p><Rich text={equipKind ? t('place.equipHelp') : t('place.help')} /></p>
		</header>

		{#if view && start}
			<div class="tools">
				<div class="zoom float">
					<button type="button" aria-label={t('common.zoomIn')} onclick={() => mapRef?.zoom(1)}
						><Icon name="plus" size={20} /></button
					>
					<button type="button" aria-label={t('common.zoomOut')} onclick={() => mapRef?.zoom(-1)}
						><Icon name="minus" size={20} /></button
					>
				</div>
				<NudgePad onnudge={(dx, dy) => mapRef?.nudge(dx, dy)} />
			</div>
		{/if}
	</div>

	<section class="panel float" aria-label={t('place.panel')}>
		{#if equipKind}
			<div class="snap ok" role="status">
				<Icon name="check" size={20} /><span>{t('place.equipHere')}</span>
			</div>
			<button class="btn" type="button" disabled={!free} onclick={goEquip}
				>{t('place.validate')}</button
			>
		{:else}
			<div class="snap" class:ok={!!snap} role="status" aria-live="polite">
				<Icon name={snap ? 'check' : 'alert'} size={20} />
				{#if snap}
					<span><Rich text={t('place.snapped', { gap: fmtDecimal(snap.distM) })} /></span>
				{:else}
					<span>{t('place.closer')}</span>
				{/if}
			</div>

			{#if near}
				<div class="near" role="alert">
					<p>{t('place.near')}</p>
					<div class="two">
						<a
							class="btn btn-secondary"
							href={resolve(`/gare/saisie?id=${encodeURIComponent(id)}&osm=node/${near.id}`)}
							>{t('place.editThis')}</a
						>
						<button class="btn" type="button" onclick={go}>{t('place.another')}</button>
					</div>
				</div>
			{:else}
				<button class="btn" type="button" disabled={!snap} onclick={validate}
					>{t('place.validate')}</button
				>
			{/if}
		{/if}
	</section>
</div>

<style>
	.screen {
		position: relative;
		height: calc(100dvh - var(--band));
		overflow: hidden;
		background: #8c877c;
	}
	.mapbox {
		position: absolute;
		inset: 0;
	}
	.status {
		position: absolute;
		inset: 45% 16px auto;
		margin: 0;
		padding: 12px;
		text-align: center;
	}
	.stack {
		position: absolute;
		top: calc(8px + env(safe-area-inset-top));
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		display: flex;
		flex-direction: column;
		gap: 8px;
		pointer-events: none;
	}
	.stack > * {
		pointer-events: auto;
	}
	.top {
		padding: 2px 12px 8px 2px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	h1 {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.4;
	}
	.top p {
		margin: 0 0 0 12px;
		font-size: 0.875rem;
		line-height: 1.43;
		color: var(--text-2);
	}
	.top p :global(strong) {
		color: var(--text);
	}
	.tools {
		align-self: flex-end;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
	}
	.zoom {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.zoom button {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
	.zoom button + button {
		border-top: 1px solid var(--overlay-line);
	}
	.panel {
		position: absolute;
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		bottom: calc(24px + env(safe-area-inset-bottom)); /* au-dessus de l'attribution */
		max-width: 560px;
		margin: 0 auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.snap {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		font-size: 0.9375rem;
		color: var(--missing);
	}
	.snap span {
		color: var(--text);
	}
	.snap.ok {
		color: var(--ok);
	}
	.near {
		padding: 10px;
		border-radius: var(--radius);
		background: var(--pancarte-soft);
	}
	.near p {
		margin: 0 0 8px;
		font-size: 0.9375rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
</style>
