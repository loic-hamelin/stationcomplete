<script lang="ts">
	// E10 — Réglages : compte OpenStreetMap, langue, thème, serveur, mode démonstration, informations.
	import { resolve } from '$app/paths';
	import BottomNav from '#lib/BottomNav.svelte';
	import Icon from '#lib/Icon.svelte';
	import { setTheme, theme, type Theme } from '#lib/theme.svelte.js';
	import { account, configured, login, logout, signedIn, syncAccount } from '#lib/auth.svelte.js';
	import { resetStation } from '#lib/current.svelte.js';
	import { setDemo, settings } from '#lib/edits.svelte.js';
	import { SERVERS, server, setServer, type ServerId } from '#lib/osmserver.svelte.js';
	import { downloads, reloadDownloads, removeDownload } from '#lib/offline.svelte.js';
	import { loadAllStations, type Station } from '#lib/stations.js';
	import { lang, LANGUAGES, setLocale } from '#lib/i18n/i18n.svelte.js';
	import { enabledCountries } from '#lib/core/countries.js';
	import { country, setCountry } from '#lib/country.svelte.js';
	import type { Locale } from '#lib/i18n/locales.js';
	import { fmtDate, fmtMegabytes, t, tk } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	let mounted = $state(false);
	let bboxes = $state<Record<string, Station['bbox']>>({});
	onMount(async () => {
		mounted = true;
		try {
			const ids = new Set(downloads.list.map((d) => d.id));
			bboxes = Object.fromEntries(
				(await loadAllStations()).filter((s) => ids.has(s.id)).map((s) => [s.id, s.bbox])
			);
		} catch {
			/* index indisponible : suppression des données seulement */
		}
	});
	const mo = fmtMegabytes;
	// Pays des gares (E3) : seuls les pays activés sont proposés ; un seul aujourd'hui.
	const countries = enabledCountries();
	const total = $derived(downloads.list.reduce((n, d) => n + d.bytes, 0));
	const THEMES = $derived<[Theme, string][]>([
		['system', t('settings.theme.system')],
		['light', t('settings.theme.light')],
		['dark', t('settings.theme.dark')]
	]);
	function choose(id: ServerId) {
		setServer(id);
		resetStation();
		syncAccount();
		reloadDownloads();
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<div class="screen">
	<main>
		<h1>{t('nav.settings')}</h1>

		<h2 class="overline">{t('settings.account')}</h2>
		<div class="group">
			<div class="row">
				{#if mounted && signedIn() && account.user}
					<span class="txt"
						><span><strong>{account.user.name}</strong></span><span class="small"
							>{SERVERS[server.id].label}</span
						></span
					>
					<button class="btn-sm" type="button" onclick={logout}>{t('settings.logout')}</button>
				{:else if mounted && configured()}
					<span class="txt"><span>{t('settings.signedOut')}</span></span>
					<button class="btn-sm" type="button" onclick={() => login()}>{t('settings.login')}</button
					>
				{:else}
					<span class="txt"
						><span>{t('settings.loginUnavailable')}</span><span class="small"
							>{t('settings.notConfigured', { server: SERVERS[server.id].label })}</span
						></span
					>
				{/if}
			</div>
		</div>

		<h2 class="overline">{t('settings.appearance')}</h2>
		<div class="group">
			<div class="row">
				<span class="txt"
					><label for="lang"
						>{t('settings.language')}{#if lang.current !== 'en'}<span class="small" lang="en"
								>&nbsp;· Language</span
							>{/if}</label
					><span class="small" id="lang-desc">{t('settings.languageHint')}</span></span
				>
				<!-- Nom de chaque langue dans sa propre langue, sans drapeau (une langue n'est pas un pays). -->
				<select
					id="lang"
					aria-describedby="lang-desc"
					value={lang.current}
					onchange={(e) => setLocale(e.currentTarget.value as Locale)}
				>
					{#each LANGUAGES as l (l.code)}
						<option value={l.code} lang={l.code}>{l.name}</option>
					{/each}
				</select>
			</div>
			<div class="row">
				{#if countries.length > 1}
					<span class="txt"
						><label for="country">{t('settings.country')}</label><span
							class="small"
							id="country-desc">{t('settings.countryHint')}</span
						></span
					>
					<select
						id="country"
						aria-describedby="country-desc"
						value={country.code}
						onchange={(e) => setCountry(e.currentTarget.value)}
					>
						{#each countries as c (c.code)}
							<option value={c.code}>{tk(`country.${c.code}.name`)}</option>
						{/each}
					</select>
				{:else}
					<span class="txt"
						><span>{t('settings.country')}</span><span class="small"
							>{t('settings.countryHint')} {t('settings.countryOnly')}</span
						></span
					>
					<span class="value">{tk(`country.${countries[0].code}.name`)}</span>
				{/if}
			</div>
			<div class="row col">
				<span class="txt"
					><span id="theme-label">{t('settings.theme.label')}</span><span class="small"
						>{t('settings.theme.hint')}</span
					></span
				>
				<div class="seg" role="group" aria-labelledby="theme-label">
					{#each THEMES as [v, label] (v)}
						<button type="button" aria-pressed={theme.value === v} onclick={() => setTheme(v)}
							>{label}</button
						>
					{/each}
				</div>
			</div>
		</div>

		<h2 class="overline">{t('settings.server')}</h2>
		<fieldset class="group">
			<legend class="visually-hidden">{t('settings.serverLegend')}</legend>
			<label class="row">
				<input
					type="radio"
					name="server"
					checked={server.id === 'prod'}
					onchange={() => choose('prod')}
				/>
				<span class="txt"
					><span>OpenStreetMap</span><span class="small">{t('settings.prodHint')}</span></span
				>
			</label>
			<label class="row">
				<input
					type="radio"
					name="server"
					checked={server.id === 'dev'}
					onchange={() => choose('dev')}
				/>
				<span class="txt"
					><span>{t('server.dev')}</span><span class="small">{t('settings.devHint')}</span></span
				>
			</label>
		</fieldset>

		<h2 class="overline">{t('settings.input')}</h2>
		<div class="group">
			<div class="row">
				<span class="txt">
					<span id="demo-label">{t('settings.demo')}</span>
					<span class="small" id="demo-desc">{t('settings.demoHint')}</span>
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={settings.demo}
					aria-labelledby="demo-label"
					aria-describedby="demo-desc"
					class="switch"
					onclick={() => setDemo(!settings.demo)}
				>
					<span></span>
				</button>
			</div>
		</div>

		<h2 class="overline">
			{t('settings.downloads')}{#if downloads.list.length}
				· {mo(total)}{/if}
		</h2>
		<div class="group">
			{#each downloads.list as d (d.id)}
				<div class="row">
					<span class="txt"
						><span>{d.name}</span><span class="small">{mo(d.bytes)} · {fmtDate(d.at)}</span></span
					>
					<button
						class="btn-sm"
						type="button"
						aria-label={t('settings.removeDownload', { name: d.name })}
						onclick={() => removeDownload(d, bboxes[d.id])}>{t('common.remove')}</button
					>
				</div>
			{:else}
				<div class="row">
					<span class="txt"
						><span>{t('settings.noDownloads')}</span><span class="small"
							>{t('settings.noDownloadsHint')}</span
						></span
					>
				</div>
			{/each}
		</div>

		<h2 class="overline">{t('legal.aboutLink')}</h2>
		<div class="group">
			<a class="row link" href={resolve('/a-propos')}>
				<span class="txt">{t('settings.aboutLink')}</span><Icon name="chev" size={18} />
			</a>
			<a class="row link" href={resolve('/donnees-personnelles')}>
				<span class="txt">{t('legal.dataLink')}</span><Icon name="chev" size={18} />
			</a>
			<a class="row link" href={resolve('/mentions-legales')}>
				<span class="txt">{t('legal.noticeLink')}</span><Icon name="chev" size={18} />
			</a>
		</div>
	</main>
	<BottomNav current="reglages" />
</div>

<style>
	/* Coque d'appli : seul le contenu défile, la barre basse ne recouvre jamais rien. */
	.screen {
		height: calc(100dvh - var(--band));
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
		gap: 6px;
	}
	main > :global(*) {
		flex-shrink: 0;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 1.5rem;
		line-height: 1.33;
	}
	.overline {
		margin: 14px 0 2px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 8px 8px 8px 14px;
	}
	.row.col {
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		padding: 10px 14px 12px;
	}
	.link {
		color: var(--text);
		text-decoration: none;
	}
	.link > :global(svg) {
		flex-shrink: 0;
		color: var(--text-3);
	}
	.txt {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
	}
	.txt > span:first-child,
	.txt > label {
		font-weight: 600;
	}
	label .small {
		font-weight: 400;
	}
	select {
		flex-shrink: 0;
		min-height: 44px;
		max-width: 50%;
		padding: 0 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.small {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.value {
		flex-shrink: 0;
		font-weight: 600;
	}
	fieldset.group {
		margin: 0;
		padding: 0;
	}
	label.row {
		cursor: pointer;
	}
	input[type='radio'] {
		width: 24px;
		height: 24px;
		margin: 0;
		accent-color: var(--primary);
		flex-shrink: 0;
	}
</style>
