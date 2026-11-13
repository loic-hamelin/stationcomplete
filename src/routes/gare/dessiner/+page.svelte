<script lang="ts">
	// E11 — Dessiner un quai absent d'OpenStreetMap (polygone libre, lot 5).
	// Les points proches d'une voie sont ramenés sur une ligne parallèle à 1,5 m de son axe,
	// seulement à moins de 12 px de la croix (lot 7d) ; les points posés se glissent au doigt.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { imageryOf } from '#lib/core/countries.js';
	import {
		EDGE_OFFSET_M,
		checkShape,
		lostTracks,
		lostTracksMessage,
		snapNear,
		snapToEdge,
		type LonLat
	} from '#lib/core/draw.js';
	import { newEditId } from '#lib/core/edits.js';
	import { isPlatform, isRail, isUnderground, type OsmNode, type OsmWay } from '#lib/core/osm.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, nextTempId, pending, saveEdit } from '#lib/edits.svelte.js';
	import DrawMap from '#lib/map/DrawMap.svelte';
	import NudgePad from '#lib/map/NudgePad.svelte';
	import { loadSnapPref, setSnapPref, snapPref } from '#lib/snap.svelte.js';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtDecimal, fmtDistance, t } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
		loadSnapPref();
	});
	const id = $derived(mounted ? (page.url.searchParams.get('id') ?? '') : '');
	$effect(() => {
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});

	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	const nodes = $derived(
		new Map(
			(view?.elements ?? [])
				.filter((e): e is OsmNode => e.type === 'node')
				.map((n) => [n.id, n] as [number, OsmNode])
		)
	);
	const coords = (w: OsmWay) =>
		w.nodes
			.map((i) => nodes.get(i))
			.filter((n): n is OsmNode => !!n)
			.map((n) => [n.lon, n.lat] as LonLat);
	const railWays = $derived(
		(view?.elements ?? []).filter((e): e is OsmWay => e.type === 'way' && isRail(e.tags))
	);
	const trackLines = $derived(railWays.map(coords));
	const tracksUnder = $derived(railWays.map((w) => isUnderground(w.tags)));
	const platformWays = $derived(
		(view?.elements ?? []).filter((e): e is OsmWay => e.type === 'way' && isPlatform(e.tags))
	);
	const platformRings = $derived(platformWays.map(coords));
	const platformsUnder = $derived(platformWays.map((w) => isUnderground(w.tags)));

	let points = $state<LonLat[]>([]);
	let selected = $state<number | undefined>();
	let centerNow = $state<LonLat | undefined>();
	let zoomNow = $state<number | undefined>();
	/** Contours précédents (annuler un point ajouté ou un déplacement) et leur nature. */
	let history = $state<{ points: LonLat[]; what: 'add' | 'move' }[]>([]);
	let said = $state('');
	let errors = $state<string[]>([]);
	let saving = $state(false);
	let mapRef = $state<{ nudge: (dx: number, dy: number) => void; zoom: (d: number) => void }>();

	// Accrochage au bord de voie : à moins de 12 px de la croix au zoom courant (lot 7d).
	const snapAt = (p: LonLat) =>
		snapPref.on && zoomNow !== undefined
			? snapNear(p, railWays, (i) => nodes.get(i), zoomNow)
			: undefined;
	const snap = $derived(centerNow ? snapAt(centerNow) : undefined);
	const preview = $derived(centerNow ? (snap?.point ?? centerNow) : undefined);
	const check = $derived(checkShape(points, trackLines, platformRings));
	const m = fmtDistance;

	/** Avertissement non bloquant (lot 7d) : le quai ne longe plus une voie où il était accroché. */
	let lostWarn = $state('');
	let saveAnyway = false;
	const keep = (what: 'add' | 'move') => {
		lostWarn = '';
		history = [...history, { points: $state.snapshot(points) as LonLat[], what }];
	};
	function add() {
		if (!preview) return;
		errors = [];
		if (selected !== undefined) {
			keep('move');
			points[selected] = preview;
			said = t('drawPage.said.moved', { n: selected + 1 });
			selected = undefined;
		} else {
			keep('add');
			points = [...points, preview];
			said = t('drawPage.said.added', { n: points.length });
		}
	}
	function undo() {
		errors = [];
		selected = undefined;
		lostWarn = '';
		const prev = history.at(-1);
		if (!prev) return;
		history = history.slice(0, -1);
		points = prev.points;
		said = prev.what === 'move' ? t('drawPage.said.moveUndone') : t('drawPage.said.removed');
	}
	/** Point déjà posé, glissé au doigt puis relâché : même accrochage (lot 7d). */
	function dragPoint(i: number, at: LonLat) {
		if (!points[i]) return;
		errors = [];
		keep('move');
		const s = snapAt(at);
		points[i] = s?.point ?? at;
		selected = undefined;
		said = s
			? t('drawPage.said.movedSnapped', { n: i + 1 })
			: t('drawPage.said.moved', { n: i + 1 });
	}
	function vertex(i: number) {
		if (i === 0 && points.length >= 3 && selected === undefined) return close();
		selected = selected === i ? undefined : i;
	}

	async function close() {
		if (!ready) return;
		if (!check.ok) {
			errors = check.errors;
			return;
		}
		// Voies longées « avant » : celles au bord desquelles un point a été accroché (à 1,5 m
		// de l'axe). Si la forme finale ne les longe plus (règle des quêtes), on le dit.
		if (!saveAnyway) {
			const lines = railWays.map((w) => ({
				id: w.id,
				ref: w.tags?.['railway:track_ref'],
				coords: coords(w)
			}));
			const along = railWays
				.filter((w) =>
					points.some((p) => {
						const s = snapToEdge(p, [w], (i) => nodes.get(i));
						return !!s && Math.abs(s.fromAxisM - EDGE_OFFSET_M) < 0.05;
					})
				)
				.map((w) => w.id);
			const lost = lostTracks(along, points, lines);
			if (lost.length) {
				lostWarn = lostTracksMessage(lost);
				said = lostWarn;
				return;
			}
		}
		saveAnyway = false;
		saving = true;
		try {
			const tempId = nextTempId();
			await saveEdit({
				kind: 'way',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				tempId,
				nodes: points.map(([lon, lat]) => ({ id: nextTempId(), lon, lat })),
				tags: { railway: 'platform', public_transport: 'platform', train: 'yes', area: 'yes' },
				summary: t('drawPage.summary', { length: m(check.lengthM) })
			});
			// Ensuite : ses numéros, si l'on est sur place (sinon il reste « sans numéro »).
			await goto(resolve(`/gare/saisie?id=${encodeURIComponent(id)}&osm=way/${tempId}`));
		} catch {
			errors = [t('common.saveFailed')];
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>{t('drawPage.title')}</title></svelte:head>

<!-- Carte plein écran ; en-tête, contrôles et actions flottent au-dessus (décision 6). -->
<div class="screen">
	<!-- data-center : centre visé, lu par les tests pour attendre la fin d'un déplacement. -->
	<div class="mapbox" data-center={centerNow?.map((v) => v.toFixed(7)).join(',')}>
		{#if view && ready}
			<DrawMap
				bind:this={mapRef}
				imagery={imageryOf(ready.station.country)}
				center={[ready.station.lon, ready.station.lat]}
				tracks={trackLines}
				platforms={platformRings}
				{tracksUnder}
				{platformsUnder}
				{points}
				{selected}
				{preview}
				snapped={!!snap}
				onmove={(c, z) => {
					centerNow = c;
					zoomNow = z;
				}}
				onvertex={vertex}
				ondragpoint={dragPoint}
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
					href={resolve(`/gare?id=${encodeURIComponent(id)}`)}
					aria-label={t('drawPage.cancel')}><Icon name="close" size={22} /></a
				>
				<h1>{t('drawPage.heading')}</h1>
				<span class="count">{t('drawPage.points', { count: points.length })}</span>
			</div>
			<p>
				{#if selected !== undefined}
					<Rich text={t('drawPage.help.move', { n: selected + 1 })} />
				{:else if points.length < 3}
					{t('drawPage.help.start')}
				{:else}
					<Rich text={t('drawPage.help.close')} />
				{/if}
			</p>
		</header>
		{#if view && ready}
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

	<section class="panel float" aria-label={t('drawPage.panel')}>
		<div class="inforow">
			<div class="info" class:ok={!!snap} role="status" aria-live="polite">
				<Icon name={snap ? 'check' : 'locate'} size={20} />
				<span>
					{#if snap}<Rich
							text={t('drawPage.snapped', { offset: fmtDecimal(EDGE_OFFSET_M) })}
						/>{:else}{t('drawPage.underCross')}{/if}
					{#if points.length >= 2}
						· {t('drawPage.length', { length: m(check.lengthM) })}{/if}
				</span>
			</div>
			<label class="snapopt">
				<input
					type="checkbox"
					role="switch"
					checked={snapPref.on}
					onchange={(e) => setSnapPref(e.currentTarget.checked)}
				/>{t('drawPage.snapOption')}
			</label>
		</div>
		<p class="visually-hidden" aria-live="polite">{said}</p>
		{#if errors.length}
			<ul class="errors banner err" role="alert">
				{#each errors as e (e)}<li>{e}</li>{/each}
			</ul>
		{/if}
		{#if lostWarn}
			<div class="lost banner warn" role="alert">
				<p><Icon name="alert" size={18} /><span>{lostWarn}</span></p>
				<div class="two">
					<button class="btn-sm" type="button" onclick={() => (lostWarn = '')}
						>{t('input.fix')}</button
					>
					<button
						class="btn-sm"
						type="button"
						disabled={saving}
						onclick={() => {
							saveAnyway = true;
							lostWarn = '';
							close();
						}}>{t('drawPage.saveAnyway')}</button
					>
				</div>
			</div>
		{/if}

		<div class="two">
			<button class="btn btn-secondary" type="button" disabled={!history.length} onclick={undo}>
				<Icon name="undo" size={20} />{history.at(-1)?.what === 'move'
					? t('drawPage.undoMove')
					: t('drawPage.undoPoint')}
			</button>
			<button class="btn" type="button" disabled={!preview} onclick={add}>
				{selected !== undefined
					? t('drawPage.moveHere', { n: selected + 1 })
					: t('drawPage.addPoint')}
			</button>
		</div>
		<button
			class="btn-quiet close"
			type="button"
			disabled={points.length < 3 || saving}
			onclick={close}
		>
			{t('drawPage.close')}
		</button>
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
		flex-grow: 1;
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.4;
	}
	.count {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
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
		padding: 8px 8px 2px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.inforow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0 8px;
	}
	.snapopt {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 6px;
		font-size: 0.875rem;
		color: var(--text-2);
		cursor: pointer;
	}
	.snapopt input {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--primary);
	}
	.info {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		font-size: 0.9375rem;
		color: var(--text-2);
	}
	.info span {
		color: var(--text);
	}
	.info.ok {
		color: var(--ok);
	}
	.errors {
		display: block;
		padding-left: 2em;
	}
	.lost {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lost p {
		display: flex;
		gap: 6px;
		margin: 0;
	}
	.lost :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.two .btn {
		padding: 0 10px;
	}
	.close {
		align-self: center;
	}
</style>
