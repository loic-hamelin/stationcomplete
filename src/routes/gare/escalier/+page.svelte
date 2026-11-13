<script lang="ts">
	// Fiche d'un escalier, escalier mécanique ou tapis roulant EXISTANT (lot Équipements, étape 3).
	// On complète, on ne dessine pas : sens de montée (incline), sens de marche (conveying), mains
	// courantes, bandes podotactiles, nombre de marches. Toutes les réponses sont relatives au sens
	// du way, montré par une flèche sur un petit schéma ; l'appli ne retourne jamais le way.
	// Sur place seulement (canSurvey) ; check_date à l'enregistrement.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { newEditId, today, type ElementKey } from '#lib/core/edits.js';
	import { LocalProjection } from '#lib/core/geo.js';
	import { OsmData, isPlatform, type OsmWay } from '#lib/core/osm.js';
	import {
		ITEMS_OF,
		parseStepCount,
		stepsTags,
		stepsValue,
		wayKindOf,
		type StepsInput
	} from '#lib/core/steps.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, pending, saveEdit } from '#lib/edits.svelte.js';
	import { canSurvey, checkOnSite, where } from '#lib/onsite.svelte.js';
	import UndergroundStart from '#lib/UndergroundStart.svelte';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtList, t, tk } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
	});
	const q = $derived(mounted ? page.url.searchParams : new URLSearchParams());
	const id = $derived(q.get('id') ?? '');
	const osm = $derived((q.get('osm') ?? '') as ElementKey | '');
	$effect(() => {
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});
	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	const way = $derived(
		view && osm.startsWith('way/')
			? (view.elements.find((e) => e.type === 'way' && `way/${e.id}` === osm) as OsmWay | undefined)
			: undefined
	);
	const kind = $derived(wayKindOf(way?.tags));
	const label = $derived(kind ? tk(`steps.kind.${kind}`) : '');
	const items = $derived(kind ? ITEMS_OF[kind] : []);
	const survey = $derived(canSurvey(id));
	const back = $derived(resolve(`/gare/carte?id=${encodeURIComponent(id)}&focus=${osm}`));

	// ---------- Schéma : le chemin et sa flèche (sens du way), quais voisins, nord en haut ----------
	const W = 320,
		H = 168;
	const sketch = $derived.by(() => {
		if (!way || !view) return undefined;
		const d = new OsmData(view.elements);
		const line = d.coords(way);
		if (line.length < 2) return undefined;
		const proj = new LocalProjection(
			(line[0][0] + line.at(-1)![0]) / 2,
			(line[0][1] + line.at(-1)![1]) / 2
		);
		const pts = line.map(([lon, lat]) => proj.project(lon, lat));
		const ext = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
		// Échelle : le chemin occupe environ la moitié du schéma, 12 m de vue au moins.
		const half = Math.max(ext * 2, 12);
		const k = Math.min(W, H) / 2 / half;
		const sx = (p: { x: number; y: number }) =>
			`${(W / 2 + p.x * k).toFixed(1)},${(H / 2 - p.y * k).toFixed(1)}`;
		const near = (r: [number, number][]) =>
			r.some(([lon, lat]) => {
				const p = proj.project(lon, lat);
				return Math.abs(p.x) < half * 2.5 && Math.abs(p.y) < half * 2;
			});
		const platforms = [...d.ways.values()]
			.filter((w) => isPlatform(w.tags))
			.map((w) => d.coords(w))
			.filter(near)
			.map((r) => r.map(([lon, lat]) => sx(proj.project(lon, lat))).join(' '));
		return { path: pts.map(sx).join(' '), platforms };
	});

	// ---------- Réponses ----------
	const input = $state<StepsInput>({});
	let initFor = '';
	$effect(() => {
		if (!way || initFor === osm || !kind) return;
		initFor = osm;
		const tg = way.tags ?? {};
		const inc = stepsValue('incline', tg);
		input.incline = inc === 'up' || inc === 'down' ? inc : undefined;
		const c = stepsValue('conveying', tg);
		input.conveying = c === 'forward' || c === 'backward' || c === 'reversible' ? c : undefined;
		const h = stepsValue('handrail', tg);
		input.handrail =
			h === 'both' || h === 'left' || h === 'right' ? h : h === 'no' ? 'no' : undefined;
		const tp = stepsValue('tactile', tg);
		input.tactile = tp === 'yes' || tp === 'no' ? tp : undefined;
		input.stepCount = tg.step_count ?? '';
	});

	let error = $state('');
	let saving = $state(false);
	async function save(confirmOnly: boolean) {
		error = '';
		if (!kind || !way || !ready) return;
		if (Number.isNaN(parseStepCount(input.stepCount))) return (error = t('stepsPage.stepCountBad'));
		const changes = confirmOnly ? {} : stepsTags(kind, $state.snapshot(input), way.tags);
		const orig = ready.elements.find((e) => `${e.type}/${e.id}` === osm);
		const tags: Record<string, string | null> = { ...changes, check_date: today() };
		const said = [
			'incline' in changes ? 'incline' : '',
			'conveying' in changes ? 'conveying' : '',
			Object.keys(changes).some((k) => k.startsWith('handrail')) ? 'handrail' : '',
			'tactile_paving' in changes ? 'tactile' : ''
		].filter(Boolean);
		if (!confirmOnly && !Object.keys(changes).length) return (error = t('stepsPage.nothing'));
		saving = true;
		try {
			await saveEdit({
				kind: 'tags',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				target: osm as ElementKey,
				version: orig?.version,
				base: Object.fromEntries(Object.keys(tags).map((k) => [k, orig?.tags?.[k] ?? null])),
				tags,
				summary: said.length
					? t('stepsPage.summary', {
							kind: label,
							items: fmtList(said.map((s) => tk(`steps.item.${s}`)))
						})
					: changes.step_count
						? t('stepsPage.summary', {
								kind: label,
								items: t('feature.stepCount', { count: Number(changes.step_count) })
							})
						: t('equip.summaryVerified', { label }),
				family: 'equip'
			});
			await goto(back);
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : t('common.saveFailed');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>{label || t('equip.title')}</title></svelte:head>

<div class="screen">
	<header class="head">
		<a class="icon-btn" href={back} aria-label={t('input.close')}><Icon name="close" size={22} /></a
		>
		<div class="h">
			<h1>
				{#if kind}<span class="fam"><Icon name={kind} size={20} /></span>{/if}{label ||
					t('equip.title')}
			</h1>
			<span class="sub">{ready?.station.name ?? ''}</span>
		</div>
	</header>

	<main>
		{#if !mounted || st.status === 'loading' || !pending.loaded}
			<p class="note" role="status">{t('common.loading')}</p>
		{:else if st.status === 'error'}
			<p class="note err" role="alert">{st.message}</p>
		{:else if !kind}
			<p class="note">{t('input.gone')}</p>
		{:else}
			{#if !survey}
				<div class="banner warn lock" role="note">
					<Icon name="lock" size={18} />
					<div>
						<p><Rich text={t('equip.onSite')} /></p>
						<button
							class="btn-sm"
							type="button"
							disabled={where.status === 'checking'}
							onclick={() => ready && checkOnSite(ready.station)}
						>
							{where.status === 'checking' ? t('stations.locating') : t('input.onSite.button')}
						</button>
						<p class="small">
							<Rich
								text={t('input.onSite.try')}
								links={{ settings: { href: resolve('/reglages') } }}
							/>
						</p>
						{#if ready}<UndergroundStart station={ready.station} compact />{/if}
					</div>
				</div>
			{/if}

			{#if sketch}
				<figure>
					<svg
						viewBox="0 0 {W} {H}"
						role="img"
						aria-label={t('stepsPage.sketch', { kind: label.toLowerCase() })}
					>
						<defs>
							<marker
								id="fleche"
								viewBox="0 0 10 10"
								refX="5"
								refY="5"
								markerWidth="3.2"
								markerHeight="3.2"
								orient="auto"
							>
								<path d="M0 0L10 5L0 10z" fill="var(--primary)" />
							</marker>
						</defs>
						<rect width={W} height={H} rx="6" class="bg" />
						{#each sketch.platforms as pl, i (i)}
							<polygon points={pl} class="pf" />
						{/each}
						<polyline points={sketch.path} class="casing" />
						<polyline points={sketch.path} class="way" marker-end="url(#fleche)" />
						<text x={W - 14} y="20" text-anchor="middle" class="north">N</text>
						<path d="M{W - 14} 24v12M{W - 18} 28l4-4 4 4" class="north-arrow" />
					</svg>
					<figcaption class="hint">{t('stepsPage.never')}</figcaption>
				</figure>
			{/if}

			{#if items.includes('conveying')}
				<fieldset disabled={!survey}>
					<legend>{t('stepsPage.conveying')}</legend>
					<div class="chips">
						{#each [['forward', 'stepsPage.forward'], ['backward', 'stepsPage.backward'], ['reversible', 'stepsPage.reversible']] as [v, k] (v)}
							<button
								type="button"
								aria-pressed={input.conveying === v}
								onclick={() => (input.conveying = v as StepsInput['conveying'])}>{tk(k)}</button
							>
						{/each}
						<button
							type="button"
							aria-pressed={input.conveying === undefined}
							onclick={() => (input.conveying = undefined)}>{t('input.equip.unknown')}</button
						>
					</div>
				</fieldset>
			{/if}
			{#if items.includes('incline')}
				<fieldset disabled={!survey}>
					<legend>{t('stepsPage.incline')}</legend>
					<div class="seg three">
						<button
							type="button"
							aria-pressed={input.incline === 'up'}
							onclick={() => (input.incline = 'up')}
							><Icon name="arrow-u" size={18} />{t('stepsPage.up')}</button
						>
						<button
							type="button"
							aria-pressed={input.incline === 'down'}
							onclick={() => (input.incline = 'down')}
							><Icon name="arrow-d" size={18} />{t('stepsPage.down')}</button
						>
						<button
							type="button"
							aria-pressed={input.incline === undefined}
							onclick={() => (input.incline = undefined)}>{t('input.equip.unknown')}</button
						>
					</div>
				</fieldset>
			{/if}
			{#if items.includes('handrail')}
				<fieldset disabled={!survey}>
					<legend>{t('stepsPage.handrail')}</legend>
					<div class="chips">
						{#each [['both', 'stepsPage.both'], ['left', 'stepsPage.left'], ['right', 'stepsPage.right'], ['no', 'stepsPage.none']] as [v, k] (v)}
							<button
								type="button"
								aria-pressed={input.handrail === v}
								onclick={() => (input.handrail = v as StepsInput['handrail'])}>{tk(k)}</button
							>
						{/each}
						<button
							type="button"
							aria-pressed={input.handrail === undefined}
							onclick={() => (input.handrail = undefined)}>{t('input.equip.unknown')}</button
						>
					</div>
				</fieldset>
			{/if}
			{#if items.includes('tactile')}
				<fieldset disabled={!survey}>
					<legend>{t('stepsPage.tactile')}</legend>
					<div class="seg three">
						<button
							type="button"
							aria-pressed={input.tactile === 'yes'}
							onclick={() => (input.tactile = 'yes')}>{t('common.yes')}</button
						>
						<button
							type="button"
							aria-pressed={input.tactile === 'no'}
							onclick={() => (input.tactile = 'no')}>{t('common.no')}</button
						>
						<button
							type="button"
							aria-pressed={input.tactile === undefined}
							onclick={() => (input.tactile = undefined)}>{t('input.equip.unknown')}</button
						>
					</div>
				</fieldset>
			{/if}
			{#if kind === 'stairs'}
				<fieldset disabled={!survey}>
					<legend>{t('stepsPage.stepCount')} <span class="opt">{t('input.optional')}</span></legend>
					<label class="field mid">
						<span class="visually-hidden">{t('stepsPage.stepCount')}</span>
						<input class="input" bind:value={input.stepCount} inputmode="numeric" maxlength="3" />
					</label>
				</fieldset>
			{/if}
			{#if error}<p class="note err" role="alert">{error}</p>{/if}
		{/if}
	</main>

	{#if kind}
		<footer>
			<button
				class="btn btn-secondary"
				type="button"
				disabled={saving || !survey}
				onclick={() => save(true)}>{t('input.correct')}</button
			>
			<button class="btn" type="button" disabled={saving || !survey} onclick={() => save(false)}
				>{t('common.save')}</button
			>
		</footer>
	{/if}
</div>

<style>
	.screen {
		min-height: calc(100dvh - var(--band));
		display: flex;
		flex-direction: column;
	}
	.h {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.head h1 {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fam {
		display: flex;
		color: var(--equip);
	}
	main {
		flex-grow: 1;
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	svg {
		width: 100%;
		height: auto;
		max-height: 200px;
	}
	.bg {
		fill: var(--surface);
		stroke: var(--border);
	}
	.pf {
		fill: var(--quai-soft);
		stroke: var(--quai);
		stroke-width: 1;
	}
	.casing {
		fill: none;
		stroke: var(--bg);
		stroke-width: 9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.way {
		fill: none;
		stroke: var(--primary);
		stroke-width: 5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.north {
		fill: var(--text-2);
		font: 600 11px var(--font);
	}
	.north-arrow {
		fill: none;
		stroke: var(--text-2);
		stroke-width: 1.5;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	legend {
		padding: 0;
		margin-bottom: 6px;
		font-size: 1rem;
		line-height: 1.4;
	}
	.opt {
		font-weight: 400;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.hint,
	.small {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.43;
		color: var(--text-2);
	}
	.note {
		margin: 0;
		color: var(--text-2);
	}
	.err {
		color: var(--danger);
		font-weight: 600;
	}
	.lock > div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	.lock p {
		margin: 0;
	}
	.lock .small {
		color: var(--text);
	}
	.field.mid {
		max-width: 120px;
	}
	.input:focus {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chips button {
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: 600 0.9375rem/1.2 var(--font);
		cursor: pointer;
	}
	.chips button[aria-pressed='true'] {
		border: 2px solid var(--primary);
		background: var(--primary-soft);
		color: var(--primary);
	}
	.chips button:disabled {
		background: var(--surface-2);
		color: var(--text-2);
		border-color: transparent;
	}
	.seg.three > button {
		font-size: 0.875rem;
	}
	footer {
		position: sticky;
		bottom: 0;
		display: flex;
		gap: 8px;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: var(--bg);
	}
</style>
