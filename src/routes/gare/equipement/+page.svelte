<script lang="ts">
	// Fiche d'un équipement ponctuel (lot Équipements, étape 2) : ascenseur ou distributeur de
	// billets. Trois cas :
	// - existant (&osm=node/123) : corriger ses attributs, ou confirmer (check_date) ;
	// - nouveau, placé sur la photo aérienne (&kind=elevator&lon=…&lat=…, depuis E6) ;
	// - nouveau, à l'intérieur ou sous terre (&kind=elevator) : situé sur un quai (quai, position
	//   le long du quai, côté), l'appli calcule un point dans le contour du quai.
	// Tout se relève sur place (canSurvey). Un équipement du même type à moins de 5 m : on
	// l'annonce avant d'en créer un autre.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { bearingName, newEditId, today, type ElementKey } from '#lib/core/edits.js';
	import { platformTitle } from '#lib/core/features.js';
	import { OsmData, type OsmNode, type OsmWay } from '#lib/core/osm.js';
	import {
		levelOk,
		nearbySame,
		newPointTags,
		platformFrame,
		pointKindOf,
		pointTagChanges,
		type Along,
		type PointKind,
		type Side
	} from '#lib/core/points.js';
	import { partKeys, type PlatformInfo } from '#lib/core/quests.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, nextTempId, pending, saveEdit } from '#lib/edits.svelte.js';
	import { canSurvey, checkOnSite, where } from '#lib/onsite.svelte.js';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtDistance, t } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
	});
	const q = $derived(mounted ? page.url.searchParams : new URLSearchParams());
	const id = $derived(q.get('id') ?? '');
	const osm = $derived((q.get('osm') ?? '') as ElementKey | '');
	// Nouvel équipement placé sur la photo (E6).
	const placed = $derived(
		q.get('lon') && q.get('lat')
			? ([Number(q.get('lon')), Number(q.get('lat'))] as [number, number])
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
	const el = $derived(
		view && osm ? view.elements.find((e) => `${e.type}/${e.id}` === osm) : undefined
	);
	const kind = $derived<PointKind | undefined>(
		osm
			? pointKindOf(el?.tags)
			: q.get('kind') === 'ticket'
				? 'ticket'
				: q.get('kind') === 'elevator'
					? 'elevator'
					: undefined
	);
	const label = $derived(
		kind ? t(kind === 'elevator' ? 'equip.kind.elevator' : 'equip.kind.ticket') : ''
	);
	const survey = $derived(canSurvey(id));
	const back = $derived(
		resolve(`/gare/carte?id=${encodeURIComponent(id)}${osm ? `&focus=${osm}` : ''}`)
	);

	// ---------- Où se trouve-t-il ? (nouvel équipement sans position) ----------
	let where_ = $state<'outside' | 'inside' | undefined>();
	let platformKey = $state<string | undefined>();
	let along = $state<'start' | 'middle' | 'end' | 'distance'>('middle');
	let distance = $state('');
	let side = $state<Side>('center');
	const platforms = $derived(view?.analysis.platforms ?? []);
	const platform = $derived(platforms.find((p) => `${p.ref.type}/${p.ref.id}` === platformKey));

	/** Contours [lon, lat] d'un quai (toutes ses parties ; contour extérieur d'un multipolygone). */
	function ringsOf(p: PlatformInfo): [number, number][][] {
		if (!view) return [];
		const d = new OsmData(view.elements);
		const ways: OsmWay[] = [];
		for (const k of partKeys(p)) {
			const [type, n] = k.split('/');
			if (type === 'way') {
				const w = d.ways.get(Number(n));
				if (w) ways.push(w);
			} else
				for (const m of d.relations.get(Number(n))?.members ?? [])
					if (m.type === 'way' && m.role !== 'inner') {
						const w = d.ways.get(m.ref);
						if (w) ways.push(w);
					}
		}
		return ways.map((w) => d.coords(w)).filter((r) => r.length > 1);
	}
	const frame = $derived(platform ? platformFrame(ringsOf(platform)) : undefined);
	/** Voies de chaque côté du quai, nommées par leur numéro (« voie 2 »). */
	const sideNames = $derived.by(() => {
		const out: Record<'left' | 'right', string[]> = { left: [], right: [] };
		if (!platform || !frame || !view) return out;
		const d = new OsmData(view.elements);
		for (const tr of platform.tracks) {
			const w = d.ways.get(tr.way);
			const pts = (w?.nodes ?? []).map((n) => d.nodes.get(n)).filter((n): n is OsmNode => !!n);
			if (!pts.length) continue;
			// Nœud de la voie le plus proche du milieu du quai.
			const mid = frame.lengthM / 2;
			const n = pts.reduce((a, b) =>
				Math.abs(frame.alongOf(b.lon, b.lat) - mid) < Math.abs(frame.alongOf(a.lon, a.lat) - mid)
					? b
					: a
			);
			if (tr.trackRef) out[frame.sideOf(n.lon, n.lat)].push(tr.trackRef);
		}
		return out;
	});
	const sideLabel = (s: 'left' | 'right') => {
		const refs = sideNames[s];
		if (refs.length) return t('equip.place.sideTrack', { refs: refs.join(', ') });
		const b = (frame?.leftBearing ?? 0) + (s === 'right' ? 180 : 0);
		return t('equip.place.sideDir', { dir: bearingName(b) });
	};
	const endLabel = (which: 'start' | 'end', inline = false) => {
		const b = which === 'start' ? frame?.startBearing : frame?.endBearing;
		return t(inline ? 'equip.place.endInline' : 'equip.place.end', { dir: bearingName(b ?? 0) });
	};
	const distanceM = $derived(Number(distance.trim().replace(',', '.')));
	const distanceBad = $derived(
		along === 'distance' &&
			(!distance.trim() ||
				!Number.isFinite(distanceM) ||
				distanceM < 0 ||
				(!!frame && distanceM > frame.lengthM))
	);
	const computed = $derived.by(() => {
		if (!frame || distanceBad) return undefined;
		const a: Along = along === 'distance' ? distanceM : along;
		return frame.place(a, side);
	});
	const platformLevel = $derived(platform?.tags.level);

	// ---------- Attributs ----------
	let level = $state('');
	let levelTouched = false;
	let wheelchair = $state<'yes' | 'no' | undefined>();
	let operator = $state('');
	let initFor = '';
	$effect(() => {
		// Équipement existant : préremplissage, une seule fois.
		if (!el || initFor === osm) return;
		initFor = osm;
		const tg = el.tags ?? {};
		level = tg.level ?? '';
		wheelchair = tg.wheelchair === 'yes' || tg.wheelchair === 'no' ? tg.wheelchair : undefined;
		operator = tg.operator ?? '';
	});
	$effect(() => {
		// Situé sur un quai : le niveau du quai, s'il est connu (tant qu'on n'a rien écrit).
		const lv = platformLevel;
		if (!levelTouched && !osm && !placed) level = lv ?? '';
	});

	// ---------- Enregistrement ----------
	let error = $state('');
	let saving = $state(false);
	let dup = $state<{ key: string; distM: number } | undefined>();

	const position = $derived<[number, number] | undefined>(
		placed ?? (where_ === 'inside' && computed ? [computed.lon, computed.lat] : undefined)
	);

	function check() {
		if (!levelOk(level)) return t('equip.levelBad');
		return '';
	}

	async function saveNew(force = false) {
		error = check();
		if (error || !kind || !ready || !view) return;
		if (!position) return (error = t('equip.place.needPlace'));
		if (!force) {
			const near = nearbySame(kind, position, view.elements)[0];
			if (near) {
				dup = { key: `${near.el.type}/${near.el.id}`, distM: near.distM };
				return;
			}
		}
		saving = true;
		try {
			const tempId = nextTempId();
			await saveEdit({
				kind: 'point',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				tempId,
				lon: position[0],
				lat: position[1],
				tags: {
					...newPointTags(kind, { level, wheelchair, operator }),
					check_date: today()
				},
				placed: placed ? 'photo' : 'platform',
				summary: label
			});
			await goto(resolve(`/gare/carte?id=${encodeURIComponent(id)}&focus=node/${tempId}`));
		} catch {
			error = t('common.saveFailed');
		} finally {
			saving = false;
		}
	}

	async function saveExisting(confirmOnly: boolean) {
		error = confirmOnly ? '' : check();
		if (error || !kind || !el || !ready) return;
		const orig = ready.elements.find((e) => `${e.type}/${e.id}` === osm);
		const changes = confirmOnly
			? {}
			: pointTagChanges(kind, { level, wheelchair, operator }, el.tags);
		const tags: Record<string, string | null> = { ...changes, check_date: today() };
		const facts = [
			changes.level ? t('feature.level', { level: changes.level.replaceAll(';', ', ') }) : '',
			changes.wheelchair ? t('feature.wheelchair', { value: changes.wheelchair }) : '',
			changes.operator ?? ''
		].filter(Boolean);
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
				summary: facts.length
					? t('equip.summaryEdit', { label, facts: facts.join(', ') })
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
	const isNew = $derived(!osm);
	const canSave = $derived(survey && !saving && (!isNew || !!position));
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
					</div>
				</div>
			{/if}

			{#if isNew && !placed}
				<fieldset>
					<legend>{t('equip.place.where')}</legend>
					<div class="seg">
						<button
							type="button"
							aria-pressed={where_ === 'outside'}
							onclick={() => (where_ = 'outside')}>{t('equip.place.outside')}</button
						>
						<button
							type="button"
							aria-pressed={where_ === 'inside'}
							onclick={() => (where_ = 'inside')}>{t('equip.place.inside')}</button
						>
					</div>
				</fieldset>
				{#if where_ === 'outside'}
					<p class="hint">{t('equip.place.outsideHint')}</p>
					<a
						class="btn-sm place"
						href={resolve(
							`/gare/placer?id=${encodeURIComponent(id)}&kind=${kind}${ready ? `&lon=${ready.station.lon}&lat=${ready.station.lat}` : ''}`
						)}><Icon name="map" size={18} />{t('equip.place.onPhoto')}</a
					>
				{:else if where_ === 'inside'}
					<p class="hint">{t('equip.place.insideHint')}</p>
					<fieldset>
						<legend>{t('equip.place.platform')}</legend>
						{#if !platforms.length}
							<p class="note">{t('equip.place.noPlatform')}</p>
						{/if}
						<div class="list">
							{#each platforms as p (`${p.ref.type}/${p.ref.id}`)}
								{@const k = `${p.ref.type}/${p.ref.id}`}
								<button
									type="button"
									class="choice-row"
									aria-pressed={platformKey === k}
									onclick={() => (platformKey = k)}
								>
									<Icon name="quai" size={18} />
									<span>{platformTitle(p.tags)}</span>
									<span class="dim"
										>{p.tags.ref
											? t('equip.place.platformTracks', {
													refs: p.tags.ref.replaceAll(';', ', '),
													length: fmtDistance(p.lengthM)
												})
											: fmtDistance(p.lengthM)}</span
									>
								</button>
							{/each}
						</div>
					</fieldset>
					{#if frame}
						<fieldset>
							<legend>{t('equip.place.along')}</legend>
							<div class="chips">
								<button
									type="button"
									aria-pressed={along === 'start'}
									onclick={() => (along = 'start')}>{endLabel('start')}</button
								>
								<button
									type="button"
									aria-pressed={along === 'middle'}
									onclick={() => (along = 'middle')}>{t('equip.place.middle')}</button
								>
								<button type="button" aria-pressed={along === 'end'} onclick={() => (along = 'end')}
									>{endLabel('end')}</button
								>
								<button
									type="button"
									aria-pressed={along === 'distance'}
									onclick={() => (along = 'distance')}>{t('equip.place.distance')}</button
								>
							</div>
							{#if along === 'distance'}
								<label class="field mid">
									<span>{t('equip.place.distanceLabel', { end: endLabel('start', true) })}</span>
									<input
										class="input"
										bind:value={distance}
										inputmode="decimal"
										maxlength="6"
										aria-describedby="dist-hint"
									/>
								</label>
								<p class="hint" id="dist-hint">
									{t('equip.place.distanceHint', { length: fmtDistance(frame.lengthM) })}
								</p>
								{#if distanceBad && distance.trim()}
									<p class="note err" role="alert">{t('equip.place.distanceBad')}</p>
								{/if}
							{/if}
						</fieldset>
						<fieldset>
							<legend>{t('equip.place.side')}</legend>
							<div class="chips">
								<button type="button" aria-pressed={side === 'left'} onclick={() => (side = 'left')}
									>{sideLabel('left')}</button
								>
								<button
									type="button"
									aria-pressed={side === 'center'}
									onclick={() => (side = 'center')}>{t('equip.place.center')}</button
								>
								<button
									type="button"
									aria-pressed={side === 'right'}
									onclick={() => (side = 'right')}>{sideLabel('right')}</button
								>
							</div>
						</fieldset>
						{#if computed}
							<p class="banner" role="status">
								<Icon name="info" size={18} />
								{t('equip.place.result', {
									platform: platformTitle(platform?.tags ?? {}),
									along: fmtDistance(computed.alongM),
									end: endLabel('start', true),
									inside: computed.inside ? 'yes' : 'no'
								})}
								{#if platformLevel}{t('equip.place.level', { level: platformLevel })}{/if}
							</p>
						{/if}
					{/if}
				{/if}
			{/if}

			{#if !isNew || placed || (where_ === 'inside' && computed)}
				<fieldset disabled={!survey}>
					<legend>
						{kind === 'elevator' ? t('equip.levels') : t('equip.level')}
						<span class="opt">{t('input.optional')}</span>
					</legend>
					<label class="field mid">
						<span class="visually-hidden"
							>{kind === 'elevator' ? t('equip.levels') : t('equip.level')}</span
						>
						<input
							class="input"
							bind:value={level}
							oninput={() => (levelTouched = true)}
							inputmode="text"
							maxlength="20"
							placeholder={kind === 'elevator' ? '-1;0' : '0'}
							aria-describedby="level-hint"
						/>
					</label>
					<p class="hint" id="level-hint">
						{kind === 'elevator' ? t('equip.levelsHint') : t('equip.levelHint')}
					</p>
				</fieldset>
				{#if kind === 'elevator'}
					<fieldset disabled={!survey}>
						<legend>{t('equip.wheelchair')}</legend>
						<div class="seg three">
							<button
								type="button"
								aria-pressed={wheelchair === 'yes'}
								onclick={() => (wheelchair = 'yes')}>{t('common.yes')}</button
							>
							<button
								type="button"
								aria-pressed={wheelchair === 'no'}
								onclick={() => (wheelchair = 'no')}>{t('common.no')}</button
							>
							<button
								type="button"
								aria-pressed={wheelchair === undefined}
								onclick={() => (wheelchair = undefined)}>{t('input.equip.unknown')}</button
							>
						</div>
					</fieldset>
				{:else}
					<fieldset disabled={!survey}>
						<legend>{t('equip.operator')} <span class="opt">{t('input.optional')}</span></legend>
						<label class="field">
							<span class="visually-hidden">{t('equip.operator')}</span>
							<input
								class="input"
								bind:value={operator}
								maxlength="80"
								placeholder={t('equip.operatorPlaceholder')}
							/>
						</label>
					</fieldset>
				{/if}
				{#if isNew}
					<p class="hint">{t('equip.isolated')}</p>
				{/if}
			{/if}

			{#if dup}
				<div class="banner warn" role="alert">
					<Icon name="alert" size={18} />
					<p>{t('equip.duplicate', { label, dist: fmtDistance(dup.distM) })}</p>
					<div class="two">
						<a
							class="btn-sm"
							href={resolve(`/gare/equipement?id=${encodeURIComponent(id)}&osm=${dup.key}`)}
							>{t('equip.editThis')}</a
						>
						<button class="btn-sm" type="button" onclick={() => saveNew(true)}
							>{t('equip.createAnyway')}</button
						>
					</div>
				</div>
			{/if}
			{#if error}<p class="note err" role="alert">{error}</p>{/if}
		{/if}
	</main>

	{#if kind && (!isNew || placed || where_ === 'inside')}
		<footer>
			{#if !isNew}
				<button
					class="btn btn-secondary"
					type="button"
					disabled={saving || !survey}
					onclick={() => saveExisting(true)}>{t('input.correct')}</button
				>
			{/if}
			<button
				class="btn"
				type="button"
				disabled={!canSave}
				onclick={() => (isNew ? saveNew() : saveExisting(false))}>{t('common.save')}</button
			>
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
	.lock p,
	.banner p {
		margin: 0;
	}
	.lock .small {
		color: var(--text);
	}
	.place {
		align-self: flex-start;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.9375rem;
	}
	.field.mid {
		max-width: 220px;
	}
	.input:focus {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.input:disabled {
		background: var(--surface-2);
		color: var(--text-2);
		border-color: transparent;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.choice-row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: 600 0.9375rem/1.25 var(--font);
		text-align: left;
		cursor: pointer;
	}
	.choice-row :global(svg) {
		flex-shrink: 0;
		color: var(--quai);
	}
	.choice-row .dim {
		margin-left: auto;
		font-weight: 400;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.choice-row[aria-pressed='true'],
	.chips button[aria-pressed='true'] {
		border: 2px solid var(--primary);
		background: var(--primary-soft);
		color: var(--primary);
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
	.seg.three > button {
		font-size: 0.875rem;
	}
	.two {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
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
