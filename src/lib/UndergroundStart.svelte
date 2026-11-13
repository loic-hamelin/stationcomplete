<script lang="ts" module>
	type Step = 'idle' | 'download' | 'locating' | 'away' | 'nogps';
	// État du parcours au niveau du module : le téléchargement recharge la gare, ce qui démonte
	// la page un instant ; le parcours reprend où il en était.
	const flow = $state<{ station?: string; step: Step; note: string; sworn: boolean }>({
		step: 'idle',
		note: '',
		sworn: false
	});
</script>

<script lang="ts">
	// Mode souterrain : « Je vais dans une gare souterraine » (page de la gare E4, fiches
	// bloquées « à distance »). 1. Télécharge la gare pour le hors-ligne si besoin ; 2. vérifie
	// la position à l'entrée, en surface ; 3. faute de GPS, déclaration sur l'honneur. Le mode
	// vaut 2 heures pour cette gare seulement (underground.svelte.ts).
	import Icon from './Icon.svelte';
	import Rich from './i18n/Rich.svelte';
	import { intlLocale, t } from './i18n/t.js';
	import { downloadStation, isDownloaded, progress } from './offline.svelte.js';
	import { locateAt, surveyFree } from './onsite.svelte.js';
	import type { Station } from './stations.js';
	import { activeUnderground, startUnderground } from './underground.svelte.js';

	let { station, compact = false }: { station: Station; compact?: boolean } = $props();

	const mine = $derived(flow.station === station.id);
	const step = $derived(mine ? flow.step : 'idle');
	const note = $derived(mine ? flow.note : '');
	const mode = $derived(activeUnderground(station.id));
	const until = $derived(
		mode
			? new Date(mode.until).toLocaleTimeString(intlLocale(), {
					hour: '2-digit',
					minute: '2-digit'
				})
			: ''
	);

	async function go() {
		const s = station;
		Object.assign(flow, { station: s.id, step: 'idle', note: '', sworn: false });
		if (!isDownloaded(s.id)) {
			if (navigator.onLine) {
				flow.step = 'download';
				await downloadStation(s);
				if (progress.error) flow.note = t('underground.downloadFailed', { error: progress.error });
			} else flow.note = t('underground.notDownloaded');
		}
		flow.step = 'locating';
		const r = await locateAt(s, true);
		if (r === 'onsite') {
			startUnderground(s.id, s.name, 'gps-entree');
			flow.step = 'idle';
		} else flow.step = r;
	}

	function declare() {
		if (!flow.sworn) return;
		startUnderground(station.id, station.name, 'declaration');
		flow.step = 'idle';
	}
</script>

{#if !surveyFree()}
	<div class="ug" class:compact role="group" aria-label={t('underground.label')}>
		{#if mode}
			<p class="row on" role="status">
				<Icon name="check" size={20} />
				<span>{t('underground.active', { time: until })}</span>
			</p>
		{:else if step === 'idle'}
			<button
				class={compact ? 'btn-sm' : 'row row-btn'}
				type="button"
				onclick={go}
				disabled={!!progress.station}
			>
				<Icon name="stairs" size={20} />
				<span>{t('underground.start')}</span>
			</button>
			{#if !compact}<p class="hint">{t('underground.hint')}</p>{/if}
		{:else if step === 'download'}
			<p class="row" role="status">
				<Icon name="download" size={20} />
				<span>{t('underground.downloading', { done: progress.done, total: progress.total })}</span>
			</p>
		{:else if step === 'locating'}
			<p class="row" role="status">
				<Icon name="locate" size={20} />
				<span>{t('underground.locating')}</span>
			</p>
		{:else if step === 'away'}
			<div class="box" role="alert">
				<p>{t('underground.away')}</p>
				<button class="btn-sm" type="button" onclick={go}>{t('common.retry')}</button>
			</div>
		{:else if step === 'nogps'}
			<div class="box">
				<p role="alert">{t('underground.noGps')}</p>
				<label class="swear">
					<input type="checkbox" bind:checked={flow.sworn} />
					<span><Rich text={t('underground.swear', { name: station.name })} /></span>
				</label>
				<div class="acts">
					<button class="btn-sm primary" type="button" disabled={!flow.sworn} onclick={declare}
						>{t('underground.declare')}</button
					>
					<button class="btn-sm" type="button" onclick={go}>{t('common.retry')}</button>
				</div>
			</div>
		{/if}
		{#if note}<p class="hint" role="status">{note}</p>{/if}
	</div>
{/if}

<style>
	.ug {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ug.compact {
		margin-top: 8px;
		align-items: flex-start;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		margin: 0;
		padding: 4px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg);
		color: var(--text);
		font-size: 0.9375rem;
	}
	.compact .row {
		min-height: 0;
		padding: 0;
		border: 0;
		background: none;
	}
	.row > :global(svg) {
		flex-shrink: 0;
		color: var(--primary);
	}
	.row.on > :global(svg) {
		color: var(--ok);
	}
	.row-btn {
		width: 100%;
		font: inherit;
		font-size: 0.9375rem;
		text-align: left;
		cursor: pointer;
	}
	.row-btn:disabled {
		color: var(--text-2);
		cursor: default;
	}
	.hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.box {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--missing-soft);
		font-size: 0.875rem;
	}
	.box p {
		margin: 0;
	}
	.swear {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-height: 44px;
		cursor: pointer;
	}
	.swear input {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		margin: 1px 0 0;
		accent-color: var(--primary);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.btn-sm.primary:not(:disabled) {
		border-color: transparent;
		background: var(--primary);
		color: var(--on-primary);
	}
</style>
