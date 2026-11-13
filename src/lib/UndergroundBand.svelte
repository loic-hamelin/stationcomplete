<script lang="ts">
	// Bandeau du mode souterrain, en haut de toutes les pages tant qu'il est actif :
	// « Mode souterrain · Gare X · encore 1 h 32 » et « Arrêter ». Expire tout seul.
	// (Chargé à la demande par NetStatus : rien au démarrage tant que le mode n'est pas actif.)
	import Icon from './Icon.svelte';
	import { t } from './i18n/t.js';
	import { activeUnderground, stopUnderground, underground } from './underground.svelte.js';
	import { onMount } from 'svelte';

	let now = $state(Date.now());
	const mode = $derived(activeUnderground());
	onMount(() => {
		const tick = () => {
			now = Date.now();
			const m = underground.mode;
			if (m && now >= m.until) stopUnderground();
		};
		tick();
		const timer = setInterval(tick, 15_000);
		return () => clearInterval(timer);
	});
	// Place réservée en haut des pages (app.css : --band) tant que le bandeau est affiché.
	$effect(() => {
		document.documentElement.classList.toggle('band', !!mode);
		return () => document.documentElement.classList.remove('band');
	});
	const left = $derived(mode ? Math.max(0, Math.ceil((mode.until - now) / 60_000)) : 0);
	const h = $derived(Math.floor(left / 60));
	const m = $derived(left % 60);
	const text = $derived(
		h
			? t('underground.leftHours', { h, m: String(m).padStart(2, '0') })
			: t('underground.leftMinutes', { m })
	);
</script>

{#if mode}
	<div class="band" role="region" aria-label={t('underground.band')}>
		<Icon name="stairs" size={18} />
		<p>
			<strong>{t('underground.band')}</strong><span aria-hidden="true">·</span><span class="name"
				>{mode.name}</span
			><span aria-hidden="true">·</span><span>{text}</span>
		</p>
		<button type="button" aria-label={t('underground.stopLabel')} onclick={stopUnderground}
			>{t('underground.stop')}</button
		>
	</div>
{/if}

<style>
	.band {
		position: fixed;
		z-index: 55;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--band);
		padding: 0 4px 0 12px;
		background: var(--text);
		color: var(--bg);
		font-size: 0.875rem;
		line-height: 1.25;
	}
	.band > :global(svg) {
		flex-shrink: 0;
	}
	p {
		flex: 1 1 auto;
		display: flex;
		gap: 6px;
		min-width: 0;
		margin: 0;
		white-space: nowrap;
	}
	p > * {
		flex-shrink: 0;
	}
	/* Seul le nom de la gare s'abrège : le temps restant reste toujours lisible. */
	p > .name {
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	button {
		flex-shrink: 0;
		min-height: 36px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: 600 0.875rem/1 var(--font);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	button:focus-visible {
		outline-color: var(--bg);
	}
</style>
