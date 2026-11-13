<script lang="ts">
	// Bandeau hors-ligne et compte rendu des envois partis tout seuls au retour du réseau.
	import { resolve } from '$app/paths';
	import Icon from './Icon.svelte';
	import { net, queue, watchNetwork } from './queue.svelte.js';
	import { t } from './i18n/t.js';
	import { readPref } from './cache.js';
	import { onMount, type Component } from 'svelte';

	// Mode souterrain : bandeau en haut de chaque page, chargé à la demande seulement si une
	// préférence « rc:underground » existe (rien de plus au démarrage). Le module du mode
	// prévient par l'événement « rc:underground » quand il démarre ou s'arrête.
	let Band = $state<Component>();
	onMount(() => {
		watchNetwork();
		const look = () =>
			!Band &&
			readPref('underground', null) &&
			import('./UndergroundBand.svelte').then((m) => (Band = m.default));
		look();
		addEventListener('rc:underground', look);
		return () => removeEventListener('rc:underground', look);
	});
	const last = $derived(queue.last);
</script>

<Band />

{#if !net.online}
	<p class="offline" role="status">
		{t('net.offline', { count: queue.list.length })}
	</p>
{/if}
{#if last}
	<div class="toast" role="status">
		<p>
			{#if last.changeset}
				<strong>{t('net.station', { name: last.name })}</strong>
				{t('net.sentAuto', { count: last.sent })}
			{:else if last.error}
				<strong>{t('net.station', { name: last.name })}</strong> {last.error}
			{:else}
				<strong>{t('net.station', { name: last.name })}</strong>
				{t('net.nothing', { conflicts: last.conflicts ?? 0 })}
			{/if}
			{#if last.conflicts}<a href={resolve('/contributions')}>{t('net.review')}</a>{/if}
		</p>
		<button
			type="button"
			aria-label={t('common.closeMessage')}
			onclick={() => (queue.last = undefined)}><Icon name="close" size={20} /></button
		>
	</div>
{/if}

<style>
	.offline {
		position: fixed;
		z-index: 50;
		top: calc(env(safe-area-inset-top) + var(--band));
		left: 50%;
		transform: translateX(-50%);
		max-width: calc(100% - 32px);
		margin: 6px 0 0;
		padding: 6px 12px;
		border-radius: var(--radius-pill);
		background: #1f1b17;
		color: #fff;
		font-size: 0.875rem;
		line-height: 1.43;
		box-shadow: var(--shadow-float);
		pointer-events: none;
	}
	.toast {
		position: fixed;
		z-index: 50;
		left: 16px;
		right: 16px;
		bottom: calc(88px + env(safe-area-inset-bottom));
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 4px 10px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg);
		border: 1px solid var(--border);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.2);
		font-size: 0.9375rem;
	}
	.toast p {
		flex-grow: 1;
		margin: 0;
	}
	.toast a {
		display: block;
		margin-top: 4px;
		font-weight: 600;
	}
	.toast button {
		width: 44px;
		height: 44px;
		border: 0;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
</style>
