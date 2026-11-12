<script lang="ts">
	import { resolve } from '$app/paths';
	import Logo from '#lib/Logo.svelte';
	import { wipeAll } from '#lib/cache.js';
	import { CONTACT_EMAIL } from '#lib/config.js';
	import { equipmentStatusSources, photoCredits } from '#lib/core/countries.js';
	import { loadEdits, pending } from '#lib/edits.svelte.js';
	import { lang } from '#lib/i18n/i18n.svelte.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { t } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	// Déclaration de confidentialité de GitHub dans la langue de l'interface (pas d'italien).
	const githubPrivacy = $derived(
		`https://docs.github.com/${lang.current === 'it' ? 'en' : lang.current}/site-policy/privacy-policies/github-general-privacy-statement`
	);
	let confirming = $state(false);
	let done = $state(false);
	onMount(() => loadEdits());

	async function wipe() {
		await wipeAll();
		pending.list = [];
		confirming = false;
		done = true;
	}
</script>

<svelte:head>
	<title>{t('data.title')}</title>
</svelte:head>

<main class="page">
	<header><Logo /></header>

	<h1>{t('legal.dataLink')}</h1>
	<p class="lead">{t('data.lead')}</p>

	<section>
		<h2>{t('data.phone.title')}</h2>
		<ul>
			<li>{t('data.phone.storage')}</li>
			<li>{t('data.phone.position')}</li>
			<li>{t('data.phone.login')}</li>
			<li>{t('data.phone.nothing')}</li>
		</ul>
	</section>

	<section>
		<h2>{t('data.publish.title')}</h2>
		<p>
			<Rich
				text={t('data.publish.text')}
				links={{
					policy: { href: 'https://osmfoundation.org/wiki/Privacy_Policy', rel: 'external' }
				}}
			/>
		</p>
	</section>

	<section>
		<h2>{t('data.services.title')}</h2>
		<p>{t('data.services.lead')}</p>
		<ul>
			<li>
				<Rich
					text={t('data.services.github')}
					links={{ gh: { href: githubPrivacy, rel: 'external' } }}
				/>
			</li>
			<li><Rich text={t('data.services.osm')} /></li>
			{#each photoCredits() as c (c.operator)}
				<li>
					<Rich
						text={t('data.services.photos', {
							operator: c.operator,
							seat: c.operatorSeat === 'France' ? t('country.fr.name') : c.operatorSeat
						})}
					/>
				</li>
			{/each}
			{#each equipmentStatusSources() as s (s.origin)}
				<li>
					<Rich
						text={t('data.services.status', {
							platform: s.platform,
							seat: s.platformSeat === 'France' ? t('country.fr.name') : s.platformSeat
						})}
					/>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>{t('data.rights.title')}</h2>
		<p>
			<Rich
				text={t('data.rights.text', { email: CONTACT_EMAIL })}
				links={{
					mail: { href: `mailto:${CONTACT_EMAIL}` },
					cnil: { href: 'https://www.cnil.fr/fr/plaintes', rel: 'external' }
				}}
			/>
		</p>

		<div class="wipe">
			{#if done}
				<p role="status">
					<Rich text={t('data.wipe.done')} />
				</p>
			{:else if confirming}
				<p role="alert">
					{#if pending.list.length}
						<strong>{t('data.wipe.lost', { count: pending.list.length })}</strong>
					{/if}
					{t('data.wipe.confirm')}
				</p>
				<div class="two">
					<button class="btn btn-secondary" type="button" onclick={() => (confirming = false)}
						>{t('common.cancel')}</button
					>
					<button class="btn danger" type="button" onclick={wipe}>{t('data.wipe.all')}</button>
				</div>
			{:else}
				<button class="btn btn-secondary" type="button" onclick={() => (confirming = true)}>
					{t('data.wipe.button')}
				</button>
			{/if}
		</div>
	</section>

	<p>
		<a href={resolve('/mentions-legales')}>{t('legal.noticeLink')}</a> ·
		<a href={resolve('/a-propos')}>{t('legal.aboutLink')}</a>
	</p>
</main>

<style>
	.page {
		max-width: 680px;
		margin: 0 auto;
		padding: 16px 24px 48px;
	}
	h1 {
		font-size: 1.75rem;
		line-height: 1.2;
		margin: 16px 0 8px;
	}
	h2 {
		font-size: 1.25rem;
		margin: 28px 0 8px;
	}
	p,
	li {
		font-size: 1.0625rem;
	}
	.lead {
		color: var(--text-2);
	}
	ul {
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wipe {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--on-danger);
	}
</style>
