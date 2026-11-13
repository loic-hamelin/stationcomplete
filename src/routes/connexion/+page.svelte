<script lang="ts">
	// E2 — Connexion au compte OpenStreetMap. Cette page reçoit aussi le retour d'OpenStreetMap.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Logo from '#lib/Logo.svelte';
	import { account, configured, finishLogin, login, signedIn } from '#lib/auth.svelte.js';
	import { srv } from '#lib/osmserver.svelte.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { t } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	let status = $state<'idle' | 'finishing' | 'done' | 'error'>('idle');
	let error = $state('');
	let mounted = $state(false);

	onMount(async () => {
		mounted = true;
		const q = page.url.searchParams;
		if (q.get('error')) {
			status = 'error';
			error = q.get('error') === 'access_denied' ? t('login.denied') : t('login.failed');
			return;
		}
		if (q.get('code')) {
			status = 'finishing';
			try {
				const back = await finishLogin();
				status = 'done';
				// Retour à la page de départ (chemin interne uniquement).
				location.replace(
					back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/connexion')
						? back
						: resolve('/')
				);
			} catch (e) {
				status = 'error';
				error = (e as Error).message;
			}
		}
	});
</script>

<svelte:head><title>{t('login.title')}</title></svelte:head>

<main class="screen">
	<header><Logo /></header>
	<section class="body">
		<h1>{t('home.osm.title')}</h1>
		{#if status === 'finishing'}
			<p role="status">{t('login.finishing')}</p>
		{:else}
			<ul>
				<li>{t('login.pseudo')}</li>
				<li>{t('login.review')}</li>
				<li>{t('login.password')}</li>
			</ul>
			<p class="server">{t('login.server')} <strong>{srv().label}</strong></p>
			{#if error}<p class="err" role="alert">{error}</p>{/if}
			{#if mounted && signedIn() && account.user}
				<p class="ok"><Rich text={t('login.signedIn', { name: account.user.name })} /></p>
				<a class="btn" href={resolve('/contributions')}>{t('login.myContributions')}</a>
			{:else if mounted && !configured()}
				<p class="err">{t('login.notConfigured')}</p>
				<a class="btn btn-secondary" href={resolve('/reglages')}>{t('nav.settings')}</a>
			{:else}
				<button class="btn" type="button" onclick={() => login(resolve('/contributions'))}>
					{t('login.button')}
				</button>
				<a class="btn btn-secondary" href={`${srv().web}/user/new`} rel="external"
					>{t('login.create')}</a
				>
			{/if}
		{/if}
	</section>
</main>

<style>
	.screen {
		min-height: calc(100dvh - var(--band));
		max-width: 520px;
		margin: 0 auto;
		padding: 16px 24px 32px;
		display: flex;
		flex-direction: column;
	}
	.body {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 14px;
	}
	h1 {
		margin: 0;
		font-size: 1.75rem;
		line-height: 1.2;
	}
	ul {
		margin: 0;
		padding: 16px 16px 16px 2.2em;
		border-radius: var(--radius);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	p {
		margin: 0;
	}
	.server {
		color: var(--text-2);
	}
	.err {
		color: var(--danger);
		font-weight: 600;
	}
	.ok {
		color: var(--ok);
	}
</style>
