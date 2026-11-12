<script lang="ts">
	import { resolve } from '$app/paths';
	import Logo from '#lib/Logo.svelte';
	import { CONTACT_EMAIL, REPO_URL } from '#lib/config.js';
	import { equipmentStatusSources, photoCredits } from '#lib/core/countries.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { t } from '#lib/i18n/t.js';
</script>

<svelte:head>
	<title>{t('legal.title')}</title>
</svelte:head>

<main class="page">
	<header><Logo /></header>

	<h1>{t('legal.noticeLink')}</h1>

	<section>
		<h2>{t('legal.publisher.title')}</h2>
		<p>
			{t('legal.publisher.text')}<br />
			{t('legal.publisher.contact')}
			<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
		</p>
	</section>

	<section>
		<h2>{t('legal.host.title')}</h2>
		<p>{t('legal.host.text')}</p>
	</section>

	<section>
		<h2>{t('legal.content.title')}</h2>
		<ul>
			<li>
				<Rich
					text={t('legal.content.osm')}
					links={{
						odbl: { href: 'https://opendatacommons.org/licenses/odbl/', rel: 'external' }
					}}
				/>
			</li>
			{#each photoCredits() as c (c.product)}
				<li>
					<Rich
						text={t('legal.content.photos', { product: c.product, licence: c.licence })}
						links={{ licence: { href: c.licenceUrl, rel: 'external' } }}
					/>
				</li>
			{/each}
			{#each equipmentStatusSources() as s (s.origin)}
				<li>
					<Rich
						text={t('legal.content.status', { operator: s.operator, licence: s.licence })}
						links={{
							lic: { href: s.licenceUrl, rel: 'external' },
							src: { href: s.datasetUrl, rel: 'external' }
						}}
					/>
				</li>
			{/each}
			<li>
				<Rich
					text={t('legal.content.code')}
					links={{ code: { href: REPO_URL, rel: 'external' } }}
				/>
			</li>
		</ul>
		<p>{t('legal.content.independent')}</p>
	</section>

	<p>
		<a href={resolve('/donnees-personnelles')}>{t('legal.dataLink')}</a> ·
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
	ul {
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
