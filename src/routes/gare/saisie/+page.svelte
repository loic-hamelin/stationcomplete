<script lang="ts">
	// E7 — Fiche objet : renseigner, corriger ou vérifier un quai, une voie ou une pancarte.
	// Les saisies restent sur le téléphone (lot 2) ; l'envoi vers OpenStreetMap arrive au lot 3.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { countryConfig } from '#lib/core/countries.js';
	import {
		bearingCode,
		bearingName,
		cleanTrackRef,
		joinRefs,
		newEditId,
		today,
		type ElementKey
	} from '#lib/core/edits.js';
	import { platformTitle } from '#lib/core/features.js';
	import { isPlatform, isRail, splitValues, type OsmWay } from '#lib/core/osm.js';
	import { partKeys } from '#lib/core/quests.js';
	import type { SignInput } from '#lib/core/stopsigns/fr.js';
	import type { SignInputBase } from '#lib/core/stopsigns/types.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, nextTempId, pending, saveEdit } from '#lib/edits.svelte.js';
	import { canSurvey, checkOnSite, where } from '#lib/onsite.svelte.js';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';
	import Rich from '#lib/i18n/Rich.svelte';
	import { t } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
	});
	const q = $derived(mounted ? page.url.searchParams : new URLSearchParams());
	const id = $derived(q.get('id') ?? '');
	const osm = $derived((q.get('osm') ?? '') as ElementKey | '');
	// Nouvelle pancarte placée sur E6
	const placed = $derived(
		q.get('way')
			? {
					way: Number(q.get('way')),
					after: Number(q.get('after')),
					lon: Number(q.get('lon')),
					lat: Number(q.get('lat')),
					bearing: Number(q.get('bearing'))
				}
			: undefined
	);
	$effect(() => {
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});

	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	// Schéma des pancartes du pays de la gare (grille de choix, tags, contrôles).
	const signs = $derived(ready ? countryConfig(ready.station.country).stopSigns : null);
	const el = $derived(
		view && osm ? view.elements.find((e) => `${e.type}/${e.id}` === osm) : undefined
	);
	const kind = $derived(
		placed
			? 'pancarte'
			: !el
				? undefined
				: signs?.isStopSign(el.tags)
					? 'pancarte'
					: isPlatform(el.tags)
						? 'quai'
						: isRail(el.tags)
							? 'voie'
							: undefined
	);
	const survey = $derived(canSurvey(id));
	// Quai logique : le quai entier (une partie d'un quai en plusieurs parties y mène aussi).
	const platform = $derived(
		kind === 'quai' && view
			? view.analysis.platforms.find((p) => (partKeys(p) as string[]).includes(osm))
			: undefined
	);
	// Quai en plusieurs parties : les numéros s'écrivent sur toutes, dans la même saisie.
	const parts = $derived(platform?.parts);
	const title = $derived(
		kind === 'quai'
			? platformTitle(platform?.tags ?? el?.tags ?? {})
			: kind === 'voie'
				? t('track.named', { ref: el?.tags?.['railway:track_ref'] ?? '' }).trim()
				: kind === 'pancarte'
					? t('map.legend.pancarte')
					: t('input.sheet')
	);
	const back = $derived(
		resolve(`/gare/carte?id=${encodeURIComponent(id)}${osm ? `&focus=${osm}` : ''}`)
	);

	// ---------------- Quai ----------------
	let refs = $state<string[]>([]);
	let newRef = $state('');
	let localRef = $state('');
	let initFor = '';
	$effect(() => {
		// Préremplissage, une seule fois par objet.
		if (!el || !view || initFor === osm) return;
		initFor = osm;
		const tg = (kind === 'quai' ? platform?.tags : undefined) ?? el.tags ?? {};
		if (kind === 'quai') {
			const info = platform;
			const fromTracks = (info?.tracks ?? []).flatMap((x) => [...splitValues(x.trackRef)]);
			const letters = /^[A-Za-z]{1,3}(;[A-Za-z]{1,3})*$/.test(tg.ref ?? '');
			refs = letters || !tg.ref ? [...new Set(fromTracks)] : [...splitValues(tg.ref)];
			localRef = tg.local_ref ?? (letters ? (tg.ref ?? '').replaceAll(';', '-') : '');
		} else if (kind === 'voie') trackRef = tg['railway:track_ref'] ?? '';
	});
	function addRef() {
		const v = cleanTrackRef(newRef);
		if (v && !refs.includes(v)) refs = [...refs, v];
		newRef = '';
	}

	// ---------------- Voie ----------------
	let trackRef = $state('');
	let changes = $state(false);

	// ---------------- Pancarte ----------------
	let correcting = $state(false);
	// Saisie en cours. Les précisions dépendent du schéma du pays (sous-formulaires plus bas) ;
	// `fr` la lit avec les types du schéma français.
	const sign = $state<Partial<SignInputBase>>({});
	const fr = sign as Partial<SignInput>;
	// Cap de la voie au point de la pancarte, pour nommer les deux sens.
	const bearing = $derived(placed?.bearing ?? wayBearingAt());
	function wayBearingAt() {
		if (!el || el.type !== 'node' || !view) return undefined;
		const w = view.elements.find(
			(e) => e.type === 'way' && (e as OsmWay).nodes.includes(el.id) && isRail(e.tags)
		) as OsmWay | undefined;
		if (!w) return undefined;
		const i = w.nodes.indexOf(el.id);
		const a = view.elements.find((e) => e.id === w.nodes[Math.max(0, i - 1)] && e.type === 'node');
		const b = view.elements.find(
			(e) => e.id === w.nodes[Math.min(w.nodes.length - 1, i + 1)] && e.type === 'node'
		);
		if (!a || !b || a.type !== 'node' || b.type !== 'node') return undefined;
		const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
		return ((Math.atan2(dx, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
	}
	const dirName = (backward: boolean) =>
		bearing === undefined
			? backward
				? t('input.dir.backward')
				: t('input.dir.forward')
			: t('input.dir.towards', {
					dir: bearingCode(bearing + (backward ? 180 : 0)),
					name: bearingName(bearing + (backward ? 180 : 0))
				});

	// ---------------- Enregistrement ----------------
	let error = $state('');
	let saving = $state(false);

	async function save(tags: Record<string, string | null>, summary: string, name?: string) {
		if (!el || !ready) return;
		// Quai en plusieurs parties : la saisie vise la partie principale et les autres parties.
		const keys = parts && platform ? partKeys(platform) : [osm as ElementKey];
		// Version et valeurs d'origine (avant toute saisie locale) : servent à détecter, à
		// l'envoi, si quelqu'un a modifié le même tag entre-temps.
		const origin = (key: string) => {
			const orig = ready?.elements.find((e) => `${e.type}/${e.id}` === key);
			return {
				version: orig?.version,
				base: Object.fromEntries(Object.keys(tags).map((k) => [k, orig?.tags?.[k] ?? null]))
			};
		};
		saving = true;
		try {
			await saveEdit({
				kind: 'tags',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				target: keys[0],
				...origin(keys[0]),
				...(keys.length > 1
					? {
							parts: keys.slice(1).map((k) => ({ target: k, ...origin(k) })),
							...(name ? { name } : {})
						}
					: {}),
				tags,
				summary:
					keys.length > 1
						? t('input.platform.summaryParts', { summary, count: keys.length })
						: summary,
				// Famille de l'objet (le résumé est rédigé dans la langue de l'interface).
				...(kind === 'quai' || kind === 'voie' ? { family: kind } : {})
			});
			await goto(back);
		} catch {
			error = t('common.saveFailed');
		} finally {
			saving = false;
		}
	}

	function saveQuai() {
		error = '';
		const ref = joinRefs(refs);
		if (!ref) return (error = t('input.platform.needRef'));
		const lr = localRef.trim().toUpperCase().slice(0, 8);
		// Tags de chaque partie du quai (une seule, sauf quai en plusieurs parties).
		const all = (parts ?? [{ tags: el?.tags ?? {} }]).map((p) => p.tags);
		const tags: Record<string, string | null> = {
			ref,
			local_ref: lr || null,
			check_date: today()
		};
		if (all.some((c) => !c.public_transport)) tags.public_transport = 'platform';
		if (all.some((c) => !c.railway)) tags.railway = 'platform';
		if (all.some((c) => !c.train)) tags.train = 'yes';
		save(
			tags,
			lr
				? t('input.platform.summaryNamed', { name: lr, refs: ref.replaceAll(';', ', ') })
				: t('input.platform.summary', { refs: ref.replaceAll(';', ', ') }),
			lr
				? t('platform.named', { ref: lr })
				: t('platform.tracks', { refs: ref.replaceAll(';', '-') })
		);
	}

	function saveVoie() {
		error = '';
		if (changes) return (error = t('input.track.split'));
		const v = cleanTrackRef(trackRef);
		if (!v) return (error = t('input.track.needRef'));
		save({ 'railway:track_ref': v, check_date: today() }, t('track.named', { ref: v }));
	}

	function verify() {
		const tags = (kind === 'quai' ? platform?.tags : undefined) ?? el?.tags ?? {};
		const what =
			kind === 'quai'
				? platformTitle(tags)
				: kind === 'voie'
					? t('track.named', { ref: tags['railway:track_ref'] ?? '' }).trim()
					: '';
		save({ check_date: today() }, t('input.verified', { kind: kind ?? '', what }));
	}

	async function saveSign() {
		error = '';
		if (!signs || !ready) return;
		const msg = signs.check(sign);
		if (msg) return (error = msg);
		const input = $state.snapshot(sign) as SignInputBase;
		const tags = { ...signs.toTags(input), check_date: today() };
		const summary = t('sign.named', { label: signs.summary(input) });
		if (placed) {
			saving = true;
			try {
				const tempId = nextTempId();
				await saveEdit({
					kind: 'node',
					id: newEditId(),
					station: id,
					country: ready.station.country,
					createdAt: Date.now(),
					tempId,
					lon: placed.lon,
					lat: placed.lat,
					way: placed.way,
					wayVersion: view?.elements.find((e) => e.type === 'way' && e.id === placed.way)?.version,
					after: placed.after,
					afterNode: (
						ready?.elements.find((e) => e.type === 'way' && e.id === placed.way) as
							OsmWay | undefined
					)?.nodes[placed.after],
					tags,
					summary
				});
				await goto(resolve(`/gare/carte?id=${encodeURIComponent(id)}&focus=node/${tempId}`));
			} catch {
				error = t('common.saveFailed');
			} finally {
				saving = false;
			}
			return;
		}
		// Correction d'une pancarte existante : on remplace toutes les clés de la pancarte
		// (railway:signal:stop* en France).
		const old = el?.tags ?? {};
		const replace: Record<string, string | null> = {};
		for (const k of Object.keys(old)) if (signs.ownsKey(k) && !(k in tags)) replace[k] = null;
		save({ ...replace, ...tags }, summary);
	}

	const choose = (type: string) => {
		const s = sign as Record<string, unknown>;
		for (const k of Object.keys(s)) if (k !== 'direction' && k !== 'position') delete s[k];
		sign.type = type;
	};
	const POSITIONS = $derived([
		['left', t('input.sign.left')],
		['right', t('input.sign.right')],
		['in_track', t('input.sign.inTrack')],
		['ground', t('input.sign.ground')]
	]);
</script>

<svelte:head><title>{t('input.title')}</title></svelte:head>

<div class="screen">
	<header class="head">
		<a class="icon-btn" href={back} aria-label={t('input.close')}><Icon name="close" size={22} /></a
		>
		<div class="h">
			<h1>
				{#if kind}<span class="fam {kind}"><Icon name={kind} size={20} /></span>{/if}{title}
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
			{#if !survey && !(kind === 'pancarte' && !placed && !correcting)}
				<div class="banner warn lock" role="note">
					<Icon name="lock" size={18} />
					<div>
						<p><Rich text={t('input.onSite.text')} /></p>
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
						{#if where.status === 'away'}<p class="small">
								{t('input.onSite.away')}
							</p>{:else if where.status === 'denied'}<p class="small">
								{t('input.onSite.denied')}
							</p>{/if}
					</div>
				</div>
			{/if}

			{#if kind === 'quai' && parts && platform}
				<!-- Quai en plusieurs parties (parties couvertes) : mêmes numéros sur chacune. -->
				<div class="banner" role="note">
					<Icon name="info" size={18} />
					<p>
						{t('input.platform.parts', {
							parts: t('feature.parts', {
								count: parts.length,
								covered: parts.filter((p) => p.covered).length
							})
						})}
					</p>
				</div>
				{#if platform.mixed}
					<div class="banner warn" role="note">
						<Icon name="alert" size={18} />
						<p>
							{t('input.platform.mixed', {
								values: [...(platform.mixed.ref ?? []), ...(platform.mixed.local_ref ?? [])]
									.map((v) => v.replaceAll(';', '-'))
									.join(' / ')
							})}
						</p>
					</div>
				{/if}
			{/if}
			{#if kind === 'quai'}
				<fieldset disabled={!survey}>
					<legend>{t('input.platform.refs')}</legend>
					<div class="tokens">
						{#each refs as r (r)}
							<span class="token">
								{r}
								<button
									type="button"
									aria-label={t('input.platform.removeRef', { ref: r })}
									onclick={() => (refs = refs.filter((x) => x !== r))}
									><Icon name="close" size={16} /></button
								>
							</span>
						{/each}
						<label class="add">
							<span class="visually-hidden">{t('input.platform.addRefLabel')}</span>
							<input
								class="input"
								bind:value={newRef}
								placeholder={t('input.platform.add')}
								inputmode="text"
								autocapitalize="characters"
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addRef())}
								onblur={addRef}
							/>
						</label>
					</div>
					<p class="hint">{t('input.platform.refsHint')}</p>
				</fieldset>
				<fieldset disabled={!survey}>
					<legend
						>{t('input.platform.letter')} <span class="opt">{t('input.optional')}</span></legend
					>
					<label class="field">
						<span class="visually-hidden">{t('input.platform.letterLabel')}</span>
						<input
							class="input"
							bind:value={localRef}
							placeholder={t('input.platform.letterPlaceholder')}
							autocapitalize="characters"
							maxlength="8"
						/>
					</label>
				</fieldset>
			{:else if kind === 'voie'}
				<fieldset disabled={!survey}>
					<legend>{t('input.track.ref')}</legend>
					<label class="field big">
						<span class="visually-hidden">{t('input.track.refLabel')}</span>
						<input
							class="input"
							bind:value={trackRef}
							placeholder={t('input.track.refPlaceholder')}
							autocapitalize="characters"
							maxlength="12"
						/>
					</label>
					<p class="hint">{t('input.track.refHint')}</p>
				</fieldset>
				<fieldset disabled={!survey}>
					<legend>{t('input.track.changes')}</legend>
					<div class="seg">
						<button type="button" aria-pressed={!changes} onclick={() => (changes = false)}
							>{t('common.no')}</button
						>
						<button type="button" aria-pressed={changes} onclick={() => (changes = true)}
							>{t('common.yes')}</button
						>
					</div>
				</fieldset>
			{:else if kind === 'pancarte'}
				{#if !placed && !correcting}
					<div class="banner">
						<p>
							<strong
								>{el?.tags?.['railway:signal:stop:caption'] ?? t('input.sign.existing')}</strong
							>
						</p>
						<p class="small">{t('input.sign.check')}</p>
					</div>
				{:else}
					<fieldset>
						<legend>{t('input.sign.which')}</legend>
						<div class="grid">
							{#each signs?.types ?? [] as ty (ty.t)}
								{#if ty.disabled}
									<button type="button" class="wide" disabled title={ty.disabled}>
										{ty.label}
									</button>
								{:else}
									<button
										type="button"
										class:wide={ty.t === 'other' || !ty.plate}
										aria-pressed={sign.type === ty.t}
										onclick={() => choose(ty.t)}
									>
										{#if ty.plate}<span class="plate">{ty.label}</span>{:else}{ty.label}{/if}
									</button>
								{/if}
							{/each}
						</div>
					</fieldset>

					<!-- Précisions propres aux pancartes françaises (schéma « fr »). -->
					{#if signs?.id === 'fr'}
						{#if fr.type === 'nV'}
							<fieldset>
								<legend>{t('input.sign.vehicles')}</legend>
								<div class="chips">
									{#each ['3', '4', '5', '6', '8', '10'] as v (v)}
										<button
											type="button"
											aria-pressed={fr.number === v}
											onclick={() => (fr.number = v)}>{v}</button
										>
									{/each}
									<label class="mini">
										<span class="visually-hidden">{t('input.sign.otherNumber')}</span>
										<input
											class="input"
											inputmode="numeric"
											placeholder={t('sign.type.otherShort')}
											maxlength="2"
											bind:value={fr.number}
										/>
									</label>
								</div>
							</fieldset>
						{:else if fr.type === 'L'}
							<fieldset>
								<legend>{t('input.sign.length')}</legend>
								<div class="chips">
									{#each ['110', '160', '220', '300', '400'] as v (v)}
										<button
											type="button"
											aria-pressed={fr.number === v}
											onclick={() => (fr.number = v)}>{v}</button
										>
									{/each}
								</div>
							</fieldset>
						{:else if fr.type === 'Z57' || fr.type === 'Z50' || fr.type === 'TGV'}
							<fieldset>
								<legend>{t('input.sign.under', { type: fr.type })}</legend>
								<div class="chips">
									{#if fr.type === 'Z57'}
										{#each [['1', 'single_unit', '1'], ['1-2', undefined, '1;2'], ['2', 'multiple_unit', '2'], ['2-3', 'multiple_unit', '2;3'], ['3', 'multiple_unit', '3']] as [lab, unit, num] (lab)}
											<button
												type="button"
												aria-pressed={fr.number === num}
												onclick={() => ((fr.number = num), (fr.unit = unit as SignInput['unit']))}
												>{lab}</button
											>
										{/each}
									{:else}
										{#each [['1', 'single_unit'], ['2', 'multiple_unit'], ['1-2', undefined]] as [lab, unit] (lab)}
											<button
												type="button"
												aria-pressed={fr.unit === unit && (fr.type !== 'TGV' || !fr.duplex)}
												onclick={() => ((fr.unit = unit as SignInput['unit']), (fr.duplex = false))}
												>{lab}</button
											>
										{/each}
										{#if fr.type === 'TGV'}
											<button
												type="button"
												aria-pressed={!!fr.duplex}
												onclick={() => ((fr.unit = 'multiple_unit'), (fr.duplex = true))}>2D</button
											>
										{/if}
									{/if}
									{#if fr.type !== 'Z50'}
										<button
											type="button"
											aria-pressed={!!fr.reversal}
											onclick={() => (fr.reversal = !fr.reversal)}>RBT</button
										>
									{/if}
								</div>
							</fieldset>
						{:else if fr.type === 'other'}
							<fieldset>
								<legend>{t('input.sign.caption')}</legend>
								<label class="field">
									<span class="visually-hidden">{t('input.sign.captionLabel')}</span>
									<input
										class="input"
										bind:value={fr.caption}
										maxlength="40"
										placeholder={t('input.sign.captionPlaceholder')}
									/>
								</label>
							</fieldset>
						{/if}
					{/if}

					<fieldset>
						<legend>{t('input.sign.direction')}</legend>
						<div class="seg">
							<button
								type="button"
								aria-pressed={sign.direction === 'backward'}
								onclick={() => (sign.direction = 'backward')}>{dirName(true)}</button
							>
							<button
								type="button"
								aria-pressed={sign.direction === 'forward'}
								onclick={() => (sign.direction = 'forward')}>{dirName(false)}</button
							>
						</div>
					</fieldset>
					<fieldset>
						<legend>{t('input.sign.position')}</legend>
						<div class="seg four">
							{#each POSITIONS as [v, lab] (v)}
								<button
									type="button"
									aria-pressed={sign.position === v}
									onclick={() => (sign.position = v as SignInputBase['position'])}>{lab}</button
								>
							{/each}
						</div>
					</fieldset>
					<p class="hint">{t('input.sign.letterHint')}</p>
				{/if}
			{/if}

			{#if error}<p class="note err" role="alert">{error}</p>{/if}
		{/if}
	</main>

	{#if kind}
		<footer>
			{#if kind === 'pancarte' && !placed && !correcting}
				<button class="btn btn-secondary" type="button" disabled={saving} onclick={verify}
					>{t('input.correct')}</button
				>
				<button class="btn" type="button" disabled={!survey} onclick={() => (correcting = true)}
					>{t('input.fix')}</button
				>
			{:else}
				{#if !placed && (el?.tags?.ref || el?.tags?.['railway:track_ref'])}
					<button class="btn btn-secondary" type="button" disabled={saving} onclick={verify}
						>{t('input.correct')}</button
					>
				{/if}
				<button
					class="btn"
					type="button"
					disabled={saving || !survey}
					onclick={kind === 'quai' ? saveQuai : kind === 'voie' ? saveVoie : saveSign}
				>
					{t('common.save')}
				</button>
			{/if}
		</footer>
	{/if}
</div>

<style>
	.screen {
		min-height: 100dvh;
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
		color: var(--quai);
	}
	.fam.voie {
		color: var(--voie);
	}
	.fam.pancarte {
		color: var(--pancarte);
	}
	main {
		flex-grow: 1;
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
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
		margin-bottom: 8px;
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
	.banner p {
		margin: 0;
	}
	.input:focus {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.input:disabled,
	.grid button:disabled,
	.chips button:disabled {
		background: var(--surface-2);
		color: var(--text-2);
		border-color: transparent;
		cursor: default;
	}
	.field.big input {
		min-height: 56px;
		max-width: 150px;
		font-size: 1.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.token {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-height: 44px;
		padding: 0 0 0 14px;
		border-radius: var(--radius);
		background: var(--voie-soft);
		color: var(--voie);
		font-weight: 600;
		font-size: 1.125rem;
		font-variant-numeric: tabular-nums;
	}
	.token button {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.add {
		width: 112px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
	}
	/* Puces de choix : filet ; choisie = filet 2 px bleu, fond bleu pâle, coche (pas seulement la couleur). */
	.grid button,
	.chips button {
		position: relative;
		min-height: 48px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: 600 0.9375rem/1.2 var(--font);
		cursor: pointer;
	}
	.grid button.wide {
		grid-column: span 2;
	}
	.grid button[aria-pressed='true'],
	.chips button[aria-pressed='true'] {
		border: 2px solid var(--primary);
		background: var(--primary-soft);
		color: var(--primary);
	}
	.grid button[aria-pressed='true']::after {
		content: '';
		position: absolute;
		top: -7px;
		right: -7px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--primary)
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E")
			center / 12px no-repeat;
		box-shadow: 0 0 0 2px var(--bg);
	}
	.grid button:disabled {
		border: 1px dashed var(--border-strong);
		background: var(--bg);
	}
	.plate {
		padding: 1px 6px;
		border: 1.5px solid #1f1b17;
		border-radius: 2px;
		background: #fff;
		color: #1f1b17;
		font-variant-numeric: tabular-nums;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chips button {
		min-width: 48px;
		min-height: 44px;
		padding: 0 12px;
		font-variant-numeric: tabular-nums;
	}
	.mini {
		width: 96px;
	}
	.mini .input {
		min-height: 44px;
	}
	.seg.four {
		grid-auto-flow: row;
		grid-template-columns: repeat(2, minmax(0, 1fr));
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
