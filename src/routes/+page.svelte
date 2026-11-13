<script lang="ts">
	import { resolve } from '$app/paths';
	import Logo from '#lib/Logo.svelte';
	import { readPref, writePref } from '#lib/cache.js';
	import type { CountryCode } from '#lib/core/countries.js';
	import { lang, LANGUAGES, setLocale } from '#lib/i18n/i18n.svelte.js';
	import { matchLocale, type Locale } from '#lib/i18n/locales.js';
	import { t, tk } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	// E1 — Bienvenue et sécurité (ux-spec.md § 3). Étape 1 : langue (et pays des gares quand
	// plusieurs pays sont activés), pré-remplie d'après le téléphone, sans localisation. La carte
	// « Sécurité » ne peut pas être passée.
	const STEPS = 4;
	const LANG = 0;
	const SAFETY = 2;
	let step = $state(0);
	let done = $state(false);

	// Pays activés : configuration chargée après le démarrage (import dynamique), pour ne pas
	// alourdir la page d'accueil (budget de poids) ; la France seule en attendant.
	let countries = $state<{ code: CountryCode }[]>([{ code: 'fr' }]);
	const multi = $derived(countries.length > 1);
	let phoneLocale = $state<Locale>('fr');
	let chosenCountry = $state<CountryCode>('fr');
	let saveCountry: ((c: CountryCode) => boolean) | undefined;

	function next() {
		if (step === LANG) finishLanguage();
		if (step < STEPS - 1) step += 1;
		else {
			done = true;
			writePref('intro', true);
		}
	}
	function finishLanguage() {
		// La langue choisie est déjà enregistrée (choix immédiat) ; le pays seulement s'il y a choix.
		if (multi) saveCountry?.(chosenCountry);
	}
	// Présentation déjà vue (préférence « rc:intro », ou « rc:onboarded ») : on propose
	// directement de choisir une gare, sans revoir l'étape de langue.
	onMount(() => {
		if (readPref('intro', false) || readPref('onboarded', false)) done = true;
		phoneLocale = matchLocale(navigator.languages);
		if (!done) loadCountries();
	});
	async function loadCountries() {
		const [{ detectCountry, enabledCountries }, { country, setCountry }] = await Promise.all([
			import('#lib/core/countries.js'),
			import('#lib/country.svelte.js')
		]);
		countries = enabledCountries().map((c) => ({ code: c.code }));
		saveCountry = setCountry;
		// Pays proposé : préférence déjà enregistrée, sinon d'après le fuseau horaire et la langue.
		chosenCountry =
			readPref<unknown>('country', undefined) === undefined
				? detectCountry({
						timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						languages: navigator.languages
					})
				: country.code;
	}
	function skip() {
		// « Passer » mène toujours à la carte sécurité si elle n'a pas été vue.
		if (step === LANG) finishLanguage();
		step = step < SAFETY ? SAFETY : STEPS - 1;
	}
</script>

<svelte:head>
	<title>{t('home.title')}</title>
</svelte:head>

<main class="screen">
	<header class="top">
		<Logo />
		{#if !done && step < STEPS - 1 && step < SAFETY}
			<button class="link" type="button" onclick={skip}>{t('home.skip')}</button>
		{:else if !done}
			<span class="counter">{t('home.step', { step: step + 1, total: STEPS })}</span>
		{/if}
	</header>

	{#if !done}
		<section class="card" aria-live="polite">
			{#if step === LANG}
				<h1>{multi ? t('home.lang.titleCountry') : t('home.lang.title')}</h1>
				<p>{t('home.lang.text')}</p>
				{#if multi}
					<h2 class="overline" id="country-label">{t('home.lang.country')}</h2>
					<div class="seg" role="group" aria-labelledby="country-label">
						{#each countries as c (c.code)}
							<button
								type="button"
								aria-pressed={chosenCountry === c.code}
								onclick={() => (chosenCountry = c.code)}
								><span class="cc">{c.code.toUpperCase()}</span>{tk(
									`country.${c.code}.name`
								)}</button
							>
						{/each}
					</div>
				{:else}
					<p class="only">
						<span class="cc">{countries[0].code.toUpperCase()}</span>
						<span>{t('home.lang.onlyCountry', { of: tk(`country.${countries[0].code}.of`) })}</span>
					</p>
				{/if}
				<fieldset class="langs">
					<legend class="overline">{t('home.lang.language')}</legend>
					<div class="group">
						{#each LANGUAGES as l (l.code)}
							<label class="lang-row" class:on={lang.current === l.code}>
								<input
									type="radio"
									name="lang"
									value={l.code}
									checked={lang.current === l.code}
									onchange={() => setLocale(l.code)}
								/>
								<span class="lang-txt">
									<span lang={l.code}>{l.name}</span>
									{#if l.code === phoneLocale}<span class="small">{t('home.lang.phone')}</span>{/if}
								</span>
							</label>
						{/each}
					</div>
				</fieldset>
			{:else if step === 1}
				<!-- Aperçu de la carte au style de l'appli : traits clairs à liseré, étiquettes compactes. -->
				<div class="illu photo" aria-hidden="true">
					<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
						<rect width="320" height="180" fill="#8C877C" />
						<rect y="58" width="320" height="64" fill="#857C6F" />
						<rect x="190" y="18" width="96" height="30" fill="#A29C90" />
						<rect x="20" y="128" width="120" height="34" fill="#9C968A" />
						<g fill="none" stroke-linecap="round">
							<path
								d="M0 64h320M0 84h320M0 112h320"
								stroke="#14110E"
								stroke-opacity=".7"
								stroke-width="3.6"
							/>
							<path d="M0 64h320M0 84h320M0 112h320" stroke="#E4E0FF" stroke-width="2" />
							<path d="M0 112h320" stroke="#857C6F" stroke-width="2" stroke-dasharray="5 3" />
							<rect
								x="30"
								y="90"
								width="250"
								height="16"
								fill="#B5EDE4"
								fill-opacity=".16"
								stroke="#14110E"
								stroke-opacity=".7"
								stroke-width="3.2"
							/>
							<rect x="30" y="90" width="250" height="16" stroke="#B5EDE4" stroke-width="1.5" />
						</g>
						<g font-family="inherit" font-size="11" font-weight="600" text-anchor="middle">
							<rect
								x="141"
								y="89"
								width="22"
								height="18"
								rx="2"
								fill="#1F1B17"
								fill-opacity=".86"
							/>
							<text x="152" y="102" fill="#fff">A</text>
							<rect x="60" y="75" width="22" height="18" rx="9" fill="#1F1B17" fill-opacity=".86" />
							<text x="71" y="88" fill="#fff">1</text>
							<rect
								x="226"
								y="103"
								width="22"
								height="18"
								rx="9"
								fill="#1F1B17"
								fill-opacity=".86"
							/>
							<text x="237" y="116" fill="#FFE08A">?</text>
							<rect x="236" y="38" width="44" height="16" rx="1" fill="#fff" stroke="#14110E" />
							<text x="258" y="50" fill="#1F1B17" font-size="10">TGV 2</text>
							<path d="M258 54v10" stroke="#14110E" stroke-width="1.5" />
						</g>
					</svg>
				</div>
				<h1>{t('home.intro.title')}</h1>
				<p>{t('home.intro.text')}</p>
			{:else if step === SAFETY}
				<div class="illu" aria-hidden="true">
					<svg width="260" height="170" viewBox="0 0 260 170">
						<rect width="260" height="62" fill="#C9CED6" />
						<path d="M0 22h260M0 42h260" stroke="#6B7280" stroke-width="4" />
						<rect y="62" width="260" height="108" fill="#E6E9EE" />
						<rect y="80" width="260" height="9" fill="#FFD400" />
						<circle cx="130" cy="114" r="10" fill="#1844EF" />
						<path
							d="M130 125v24M130 134l-12 9M130 134l12 9M130 149l-9 16M130 149l9 16"
							stroke="#1844EF"
							stroke-width="6"
							stroke-linecap="round"
						/>
					</svg>
				</div>
				<p class="kicker">{t('home.safety.kicker')}</p>
				<h1>{t('home.safety.title')}</h1>
				<p>{t('home.safety.text')}</p>
			{:else}
				<div class="illu" aria-hidden="true">
					<svg width="260" height="170" viewBox="0 0 260 170">
						<circle cx="130" cy="85" r="62" fill="none" stroke="currentColor" stroke-width="3" />
						<path
							d="M76 70h108M76 100h108M130 23c-24 22-24 102 0 124M130 23c24 22 24 102 0 124"
							stroke="currentColor"
							stroke-width="2"
							fill="none"
						/>
					</svg>
				</div>
				<h1>{t('home.osm.title')}</h1>
				<p>{t('home.osm.text')}</p>
			{/if}
		</section>

		<footer class="actions">
			<div class="dots" role="img" aria-label={t('home.step', { step: step + 1, total: STEPS })}>
				{#each { length: STEPS }, i (i)}
					<span class:active={i === step}></span>
				{/each}
			</div>
			<button class="btn" type="button" onclick={next}>
				{step === SAFETY
					? t('home.understood')
					: step === STEPS - 1
						? t('home.start')
						: t('home.next')}
			</button>
			{#if step === LANG}<p class="later">{t('home.lang.later')}</p>{/if}
		</footer>
	{:else}
		<section class="card">
			<h1>{t('home.explore.title')}</h1>
			<p>{t('home.explore.text')}</p>
		</section>
		<footer class="actions">
			<a class="btn" href={resolve('/gares')}>{t('home.chooseStation')}</a>
			<a class="btn btn-secondary" href={resolve('/a-propos')}>{t('home.more')}</a>
			<button
				class="link"
				type="button"
				onclick={() => ((done = false), (step = 0), loadCountries())}
			>
				{t('home.replay')}
			</button>
		</footer>
	{/if}
</main>

<style>
	.screen {
		min-height: calc(100dvh - var(--band));
		max-width: 480px;
		margin: 0 auto;
		padding: 8px 24px 24px;
		display: flex;
		flex-direction: column;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.counter {
		color: var(--text-2);
		font-size: 0.875rem;
	}
	.card {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 12px;
	}
	.illu {
		display: flex;
		justify-content: center;
		padding: 20px 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--text-2);
	}
	.illu svg {
		max-width: 100%;
		height: auto;
	}
	.illu.photo {
		padding: 0;
		overflow: hidden;
		aspect-ratio: 16 / 9;
	}
	.illu.photo svg {
		width: 100%;
		height: 100%;
	}
	h1 {
		margin: 8px 0 0;
		font-size: 1.625rem;
		line-height: 1.23;
	}
	p {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.55;
		color: var(--text-2);
	}
	.kicker {
		margin-top: 8px;
		color: var(--danger);
		font-weight: 600;
		font-size: 0.8125rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-top: 24px;
	}
	.dots {
		display: flex;
		gap: 6px;
	}
	.dots span {
		width: 6px;
		height: 6px;
		border-radius: 3px;
		background: var(--border-strong);
	}
	.dots span.active {
		width: 20px;
		background: var(--text);
	}
	.overline {
		margin: 12px 0 0;
	}
	.only {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9375rem;
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
		line-height: 1;
	}
	.langs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.langs legend {
		padding: 0;
		margin-bottom: 8px;
	}
	.lang-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 52px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.lang-row.on {
		background: var(--primary-soft);
	}
	.lang-row input {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--primary);
	}
	.lang-txt {
		display: flex;
		flex-direction: column;
		font-weight: 600;
	}
	.small {
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--text-2);
	}
	.later {
		font-size: 0.875rem;
		text-align: center;
	}
	.link {
		min-height: 44px;
		padding: 0 4px;
		border: 0;
		background: transparent;
		color: var(--primary);
		font: 600 0.9375rem var(--font);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
