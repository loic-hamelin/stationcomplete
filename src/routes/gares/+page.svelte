<script lang="ts">
	// E3 — Choisir une gare (ux-spec.md § 3, E3) : carte « Reprendre », recherche (pertinence puis
	// distance, résultats groupés par pays), gares autour de moi, « À compléter près de vous »,
	// favorites et récentes, en petites fiches (distance, commune et subdivision, halte, favori,
	// hors-ligne, mini-jauge quais · voies · pancartes).
	import { resolve } from '$app/paths';
	import BottomNav from '#lib/BottomNav.svelte';
	import Icon from '#lib/Icon.svelte';
	import { getCachedStation, getCachedStationKeys } from '#lib/cache.js';
	import { enabledCountries, type CountryCode } from '#lib/core/countries.js';
	import { stationCacheKey } from '#lib/core/storage.js';
	import { country } from '#lib/country.svelte.js';
	import { lastOpened, recentIds } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, mine, pending } from '#lib/edits.svelte.js';
	import { favorites, isFavorite, toggleFavorite } from '#lib/favorites.svelte.js';
	import { fmtDate, fmtNumber, t, tk } from '#lib/i18n/t.js';
	import type { LocalState } from '#lib/localGauges.js';
	import { isDownloaded } from '#lib/offline.svelte.js';
	import { server } from '#lib/osmserver.svelte.js';
	import { locate, locateIfAllowed, position } from '#lib/position.svelte.js';
	import {
		distanceM,
		formatDistance,
		groupByCountry,
		loadAllStations,
		loadStations,
		nearby,
		search,
		todoCount,
		type Gauges,
		type Station
	} from '#lib/stations.js';
	import { onMount } from 'svelte';

	/** Rayon de « À compléter près de vous ». */
	const TODO_RADIUS_M = 30_000;
	/** Une gare ouverte depuis moins longtemps est proposée dans « Reprendre ». */
	const RESUME_MS = 24 * 3600 * 1000;

	let mounted = $state(false);
	let stations = $state<Station[]>([]); // pays courant
	let all = $state<Station[]>([]); // pays activés, le pays courant d'abord
	let version = $state('');
	let error = $state('');
	let query = $state('');
	let subNames = $state<Partial<Record<CountryCode, Record<string, string>>>>({});
	let cachedKeys = $state<Set<string> | null>(null);
	let local = $state<Record<string, LocalState>>({});
	// Gares déjà analysées (ou essayées) : simple mémo, pas un état affiché.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const tried = new Set<string>();

	const multi = enabledCountries().length > 1;
	const byId = $derived(new Map(all.map((s) => [s.id, s])));
	const here = $derived(position.here);
	const q = $derived(query.trim());
	// Toutes les correspondances sont comptées ; les 30 premières sont affichées.
	const matches = $derived(q.length >= 2 ? search(all, q, Infinity, here ?? undefined) : []);
	const results = $derived(matches.slice(0, 30));
	const groups = $derived(groupByCountry(results, country.code));

	const around = $derived(here ? nearby(all, here.lat, here.lon, 4) : []);
	const todo = $derived(
		here
			? all
					.filter((s) => s.gauges)
					.map((s) => ({ s, d: distanceM(here.lat, here.lon, s.lat, s.lon) }))
					.filter((x) => x.d <= TODO_RADIUS_M)
					.map((x) => ({ ...x, n: todoCount(x.s.gauges!) }))
					.filter((x) => x.n > 0)
					.sort((a, b) => b.n - a.n || a.d - b.d)
					.slice(0, 4)
			: []
	);
	const favs = $derived(favorites.ids.map((id) => byId.get(id)).filter((s): s is Station => !!s));
	const recent = $derived(
		mounted
			? recentIds()
					.filter((id) => !favorites.ids.includes(id))
					.map((id) => byId.get(id))
					.filter((s): s is Station => !!s)
			: []
	);

	// Carte « Reprendre » : gare de la dernière saisie en attente, sinon dernière gare ouverte
	// il y a moins de 24 h.
	const resume = $derived.by(() => {
		if (!mounted || !all.length) return undefined;
		const last = mine().at(-1);
		if (last && byId.has(last.station))
			return { s: byId.get(last.station)!, edits: editsOf(last.station).length };
		const lo = lastOpened();
		if (lo && Date.now() - lo.at < RESUME_MS && byId.has(lo.id))
			return { s: byId.get(lo.id)!, edits: 0 };
		return undefined;
	});

	const shown = $derived([
		...(resume ? [resume.s] : []),
		...results,
		...around.map((x) => x.s),
		...todo.map((x) => x.s),
		...favs,
		...recent
	]);
	const gaugesOf = (s: Station): Gauges | undefined => local[s.id]?.gauges ?? s.gauges;
	const anyGauge = $derived(shown.some((s) => gaugesOf(s)));

	onMount(async () => {
		mounted = true;
		loadEdits();
		locateIfAllowed();
		getCachedStationKeys().then((k) => (cachedKeys = new Set(k)));
		try {
			// Recherche dans tous les pays activés (un seul aujourd'hui), le pays courant d'abord.
			const idx = await loadStations(country.code);
			stations = idx.stations;
			version = idx.version;
			all = await loadAllStations(country.code);
		} catch (e) {
			error = (e as Error).message;
		}
		for (const c of enabledCountries())
			c.subdivision
				.names?.()
				.then((m) => (subNames = { ...subNames, [c.code]: m.default }))
				.catch(() => {});
	});

	// Jauges exactes des gares affichées déjà ouvertes sur ce téléphone (analyse locale).
	$effect(() => {
		if (!cachedKeys || !pending.loaded) return;
		const todoIds = shown.filter(
			(s) => !tried.has(s.id) && cachedKeys!.has(stationCacheKey(server.id, s.id))
		);
		if (!todoIds.length) return;
		for (const s of todoIds) tried.add(s.id);
		(async () => {
			const { localState } = await import('#lib/localGauges.js');
			for (const s of todoIds) {
				const cached = await getCachedStation(stationCacheKey(server.id, s.id));
				if (!cached) continue;
				try {
					local = { ...local, [s.id]: localState(s, cached.elements, editsOf(s.id)) };
				} catch {
					/* données abîmées : jauge de l'index */
				}
			}
		})();
	});

	const subOf = (s: Station) =>
		[
			s.commune && s.commune !== s.name ? s.commune : '',
			s.admin
				? subNames[s.country]?.[s.admin]
					? `${subNames[s.country]![s.admin]} (${s.admin})`
					: s.admin
				: ''
		]
			.filter(Boolean)
			.join(' · ');
	const distOf = (s: Station) =>
		here ? formatDistance(distanceM(here.lat, here.lon, s.lat, s.lon)) : '';
	const frac = (g: { done: number; total: number }) =>
		g.total ? t('stations.of', { done: g.done, total: g.total }) : t('stations.gaugeNone');
	const gaugeText = (g: Gauges) =>
		t('stations.gaugeA11y', {
			platforms: frac(g.platforms),
			tracks: frac(g.tracks),
			signs: frac(g.stopSigns)
		});
	const pct = (g: { done: number; total: number }) =>
		g.total ? Math.round((g.done / g.total) * 100) : 0;
	const KINDS = [
		['quai', 'platforms'],
		['voie', 'tracks'],
		['pancarte', 'stopSigns']
	] as const;
	const countryName = (c: CountryCode) => tk(`country.${c}.name`);
</script>

<svelte:head><title>{t('stations.title')}</title></svelte:head>

{#snippet mini(g: Gauges)}
	<span class="mini" aria-hidden="true">
		{#each KINDS as [kind, key] (kind)}
			<span class="gseg {kind}" class:empty={!g[key].total}
				><span style:width="{pct(g[key])}%"></span></span
			>
		{/each}
	</span>
{/snippet}

{#snippet fiche(s: Station, extra?: { todo?: number; distance?: boolean })}
	{@const g = gaugesOf(s)}
	{@const d = distOf(s)}
	{@const sub = subOf(s)}
	<li class="fiche">
		<a href={resolve(`/gare?id=${encodeURIComponent(s.id)}`)}>
			<span class="main">
				<span class="name-line">
					<span class="name">{s.name}</span>
					{#if multi && s.country !== country.code}<span class="cc"
							>{s.country.toUpperCase()}<span class="visually-hidden">
								· {countryName(s.country)}</span
							></span
						>{/if}
					{#if s.halt}<span class="tag">{t('stations.halt')}</span>{/if}
					{#if isDownloaded(s.id)}<span class="dl"
							><Icon name="download" size={16} label={t('stations.offline')} /></span
						>{/if}
				</span>
				{#if sub || (extra?.todo !== undefined && d)}<span class="sub"
						>{[sub, extra?.todo !== undefined ? d : ''].filter(Boolean).join(' · ')}</span
					>{/if}
			</span>
			<span class="side">
				{#if extra?.todo !== undefined}
					<span class="todo-n">{t('stations.todoCount', { count: extra.todo })}</span>
				{:else if d}
					<span class="dist">{d}</span>
				{/if}
				{#if g}{@render mini(g)}<span class="visually-hidden">{gaugeText(g)}</span>{/if}
			</span>
		</a>
		<button
			class="fav"
			type="button"
			aria-pressed={isFavorite(s.id)}
			aria-label={t('stations.fav', { name: s.name })}
			onclick={() => toggleFavorite(s.id)}
		>
			<Icon name="star" size={20} />
		</button>
	</li>
{/snippet}

<div class="screen">
	<main>
		<header class="top">
			<h1>{t('home.chooseStation')}</h1>
			{#if stations.length}
				<p class="lead">
					{t('stations.summary', {
						country: countryName(country.code),
						count: fmtNumber(stations.length)
					})}
				</p>
			{/if}
		</header>

		<label class="search">
			<Icon name="search" size={20} />
			<span class="visually-hidden">{t('stations.searchLabel')}</span>
			<input
				type="search"
				bind:value={query}
				placeholder={t('stations.placeholder')}
				autocomplete="off"
				enterkeyhint="search"
			/>
		</label>

		{#if error}
			<p class="banner err" role="alert"><Icon name="alert" size={18} />{error}</p>
		{:else if !stations.length}
			<p class="note" role="status">{t('stations.loading')}</p>
		{/if}

		{#if q.length >= 2}
			<!-- Recherche -->
			{#if results.length}
				<div class="sec-head">
					<h2 class="overline">{t('stations.resultsCount', { count: matches.length })}</h2>
					{#if here}<span class="aside">{t('stations.closestFirst')}</span>{/if}
				</div>
				{#each groups as grp (grp.country)}
					{#if groups.length > 1}
						<h3 class="group-head">
							<span class="cc">{grp.country.toUpperCase()}</span>{countryName(grp.country)}
						</h3>
					{/if}
					<ul class="list">
						{#each grp.stations as s (s.id)}{@render fiche(s)}{/each}
					</ul>
				{/each}
				<p class="hint"><Icon name="info" size={16} />{t('stations.searchHint')}</p>
			{:else if stations.length}
				<p class="note" role="status">{t('stations.noMatch', { query: q })}</p>
			{/if}
		{:else}
			{#if resume}
				{@const s = resume.s}
				{@const ls = local[s.id]}
				{@const g = gaugesOf(s)}
				<section class="resume" aria-labelledby="resume-name">
					<div class="r-head">
						<div class="r-titles">
							<p class="overline r-over">{t('stations.resume.title')}</p>
							<h2 id="resume-name">{s.name}</h2>
							<p class="sub">
								{[subOf(s), distOf(s)].filter(Boolean).join(' · ')}
								{#if isDownloaded(s.id)}<span class="r-dl"
										><Icon name="download" size={14} />{t('stations.offlineShort')}</span
									>{/if}
							</p>
							{#if resume.edits}<p class="sub r-edits">
									<Icon name="send" size={14} />{t('stations.resume.pending', {
										count: resume.edits
									})}
								</p>{/if}
						</div>
						<button
							class="fav"
							type="button"
							aria-pressed={isFavorite(s.id)}
							aria-label={t('stations.fav', { name: s.name })}
							onclick={() => toggleFavorite(s.id)}
						>
							<Icon name="star" size={20} />
						</button>
					</div>
					{#if g}
						<ul class="r-gauges">
							{#each KINDS as [kind, key] (kind)}
								<li class={kind}>
									<Icon name={kind} size={18} />
									<span class="r-label">{tk(`stations.gauge.${key}`)}</span>
									<span class="r-bar" aria-hidden="true"
										><span style:width="{pct(g[key])}%"></span></span
									>
									<span class="r-num">{g[key].total ? `${g[key].done}/${g[key].total}` : '—'}</span>
								</li>
							{/each}
						</ul>
					{/if}
					{#if ls?.next}
						{@const sid = encodeURIComponent(s.id)}
						<a
							class="btn"
							href={ls.next.draw
								? resolve(`/gare/dessiner?id=${sid}`)
								: resolve(`/gare/carte?id=${sid}${ls.next.focus ? `&focus=${ls.next.focus}` : ''}`)}
							>{t('stations.resume.continue', { task: ls.next.title })}<Icon
								name="chev"
								size={18}
							/></a
						>
					{:else}
						<a class="btn" href={resolve(`/gare?id=${encodeURIComponent(s.id)}`)}
							>{ls ? t('stations.resume.allDone') : t('stations.resume.open')}<Icon
								name="chev"
								size={18}
							/></a
						>
					{/if}
				</section>
			{/if}

			<!-- Autour de moi -->
			{#if around.length}
				<div class="sec-head">
					<h2 class="overline">{t('stations.around')}</h2>
					<button
						class="btn-quiet"
						type="button"
						onclick={() => ((position.here = null), locate())}
						disabled={position.locating}
					>
						<Icon name="refresh" size={18} />{position.locating
							? t('stations.locating')
							: t('stations.relocate')}
					</button>
				</div>
				<ul class="list">
					{#each around as { s } (s.id)}{@render fiche(s)}{/each}
				</ul>
			{:else}
				<button
					class="btn-sm near"
					type="button"
					onclick={locate}
					disabled={!stations.length || position.locating}
				>
					<Icon name="locate" size={20} />
					{position.locating ? t('stations.locating') : t('stations.nearby')}
				</button>
			{/if}
			{#if position.error}<p class="banner warn" role="status">
					<Icon name="alert" size={18} />{position.error}
				</p>{/if}

			{#if todo.length}
				<h2 class="overline">{t('stations.todoTitle')}</h2>
				<ul class="list">
					{#each todo as { s, n } (s.id)}{@render fiche(s, {
							todo: local[s.id] ? todoCount(local[s.id].gauges) : n
						})}{/each}
				</ul>
			{/if}

			{#if favs.length}
				<h2 class="overline">{t('stations.favorites')}</h2>
				<ul class="list">
					{#each favs as s (s.id)}{@render fiche(s)}{/each}
				</ul>
			{/if}

			{#if recent.length}
				<h2 class="overline">{t('stations.recent')}</h2>
				<ul class="list">
					{#each recent as s (s.id)}{@render fiche(s)}{/each}
				</ul>
			{/if}

			{#if !around.length && !recent.length && !favs.length && !resume && stations.length}
				<p class="note">
					{t('stations.count', {
						count: fmtNumber(stations.length),
						of: tk(`country.${country.code}.of`)
					})}
				</p>
			{/if}
		{/if}

		{#if anyGauge}
			<p class="hint">
				<Icon name="info" size={16} />{t('stations.gaugeNote', {
					date: version ? fmtDate(new Date(version)) : ''
				})}
			</p>
		{/if}
	</main>
	<BottomNav current="gare" />
</div>

<style>
	/* Coque d'appli : seul le contenu défile, la barre basse ne recouvre jamais rien. */
	.screen {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	main {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		width: 100%;
		padding: 20px 16px;
		/* colonne de 640 px au plus, barre de défilement au bord de l'écran */
		padding-inline: max(16px, calc((100% - 640px) / 2));
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	main > :global(*) {
		flex-shrink: 0;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		line-height: 1.33;
	}
	.lead {
		margin: 2px 0 0;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.overline {
		margin-bottom: 0;
	}
	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 4px;
	}
	.sec-head .overline {
		margin: 0;
	}
	.aside {
		font-size: 0.8125rem;
		color: var(--text-2);
	}
	.sec-head .btn-quiet {
		margin-right: -12px;
		font-size: 0.875rem;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 0 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text-2);
	}
	.search:focus-within {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	input {
		flex-grow: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--text);
		font: 1rem var(--font);
		min-height: 44px;
	}
	input::placeholder {
		color: var(--text-3);
	}
	.near {
		align-self: flex-start;
		min-height: 48px;
		padding: 0 16px 0 12px;
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 0 0;
		font-size: 0.9375rem;
	}

	/* Fiches ------------------------------------------------------------------------------- */
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.fiche {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--border);
	}
	.fiche a {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		padding: 8px 0;
		color: var(--text);
		text-decoration: none;
	}
	.main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.name-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 6px;
	}
	.name {
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.35;
	}
	.sub {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.4;
		color: var(--text-2);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 6px;
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.tag::first-letter {
		text-transform: uppercase;
	}
	.cc {
		display: inline-flex;
		align-items: center;
		height: 18px;
		padding: 0 4px;
		border: 1px solid var(--border-strong);
		border-radius: 3px;
		color: var(--text-2);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.05em;
	}
	.dl {
		display: inline-flex;
		color: var(--text-2);
	}
	.side {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
	}
	.dist {
		font-size: 0.9375rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.todo-n {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--missing);
	}
	.fav {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--target-min);
		height: var(--target-min);
		margin-right: -10px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.fav[aria-pressed='true'] {
		color: var(--primary);
	}
	.fav[aria-pressed='true'] :global(svg) {
		fill: currentColor;
	}

	/* Mini-jauge : quais · voies · pancartes (longueur = part renseignée) */
	.mini {
		display: inline-flex;
		gap: 3px;
	}
	.gseg {
		width: 16px;
		height: 4px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
		--c: var(--quai);
	}
	.gseg > span {
		display: block;
		height: 100%;
		background: var(--c);
	}
	.gseg.voie {
		--c: var(--voie);
	}
	.gseg.pancarte {
		--c: var(--pancarte);
	}
	.gseg.empty {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--border);
	}

	/* Reprendre ---------------------------------------------------------------------------- */
	.resume {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px 14px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg);
	}
	.r-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.r-titles {
		flex: 1 1 auto;
		min-width: 0;
	}
	.r-over {
		margin: 0 0 2px;
	}
	.resume h2 {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1.3;
	}
	.r-dl,
	.r-edits {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.r-dl {
		margin-left: 4px;
	}
	.r-gauges {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.r-gauges li {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) minmax(60px, 34%) 3.2em;
		align-items: center;
		gap: 8px;
		font-size: 0.9375rem;
		--c: var(--quai);
	}
	.r-gauges li.voie {
		--c: var(--voie);
	}
	.r-gauges li.pancarte {
		--c: var(--pancarte);
	}
	.r-gauges li > :global(svg) {
		color: var(--c);
	}
	.r-bar {
		height: 6px;
		border-radius: 3px;
		background: var(--border);
		overflow: hidden;
	}
	.r-bar > span {
		display: block;
		height: 100%;
		background: var(--c);
	}
	.r-num {
		text-align: right;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.resume .btn {
		justify-content: center;
	}

	.note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.hint {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 4px 0 0;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-2);
	}
	.hint > :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
</style>
