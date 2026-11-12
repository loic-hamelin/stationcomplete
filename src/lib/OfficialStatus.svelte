<script lang="ts" module>
	import type { StatusDeps } from './core/officialStatus.js';
	// Cache en mémoire partagé par toutes les ouvertures de gare (10 minutes par gare).
	const cache: StatusDeps['cache'] = new Map();
</script>

<script lang="ts">
	// E4 — État officiel des ascenseurs et escaliers mécaniques (D4 bis, lot S1), chargé à la
	// demande par la page de la gare. Lecture seule de l'open data de l'exploitant ; rien n'est
	// stocké ni envoyé par stationcomplete. Rien n'est affiché si la gare n'est pas couverte ou si
	// config.json coupe l'affichage ; un message discret si la source est injoignable.
	import { untrack } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.js';
	import Rich from './i18n/Rich.svelte';
	import { fmtDateTime, t } from './i18n/t.js';
	import {
		countStates,
		readOfficialStatus,
		statusSourceFor,
		type EquipmentState,
		type StatusResult
	} from './core/officialStatus.js';
	import type { EquipmentStatusSource } from './core/countries.js';
	import { refreshConfig } from './remote.svelte.js';
	import type { Station } from './stations.js';

	let { station }: { station: Station } = $props();

	let source = $state<EquipmentStatusSource | null>(null);
	let result = $state<StatusResult | undefined>();
	let busy = $state(false);

	async function load(force = false) {
		busy = true;
		// Arrêt d'urgence relu à chaque ouverture (fichier du site, sans cache).
		const cfg = await refreshConfig();
		const src = statusSourceFor(station.country, cfg);
		const r = await readOfficialStatus(
			{ id: station.id, uic: station.uic },
			src,
			{ fetch: (...a) => fetch(...a), now: Date.now, cache },
			force
		);
		source = src;
		result = r;
		busy = false;
	}

	$effect(() => {
		// Relu quand on change de gare seulement.
		void station.id;
		untrack(() => {
			result = undefined;
			load();
		});
	});

	const STATE_ICON: Record<EquipmentState, IconName> = {
		ok: 'check',
		ko: 'close',
		unknown: 'question'
	};
	const ok = $derived(result?.kind === 'ok' ? result.status : undefined);
	const counts = $derived(ok ? countStates(ok.equipment) : undefined);
	const ch = $derived(source?.channels);
</script>

{#if source && result && result.kind !== 'none'}
	<section class="official" aria-labelledby="official-title" aria-busy={busy}>
		<div class="head">
			<h2 id="official-title">{t('official.title')}</h2>
			<button
				class="icon-btn"
				type="button"
				aria-label={t('official.refresh')}
				disabled={busy}
				onclick={() => load(true)}
			>
				<Icon name="refresh" size={20} />
			</button>
		</div>

		{#if busy}
			<p class="meta" role="status">{t('official.loading')}</p>
		{/if}

		{#if ok && counts}
			<p class="summary">
				{t('official.summary', { total: ok.equipment.length, ko: counts.ko })}
			</p>
			<ul class="eq">
				{#each ok.equipment as e (e.id)}
					<li class={e.state}>
						<span class="st"
							><Icon name={STATE_ICON[e.state]} size={18} />{t(`official.state.${e.state}`)}</span
						>
						<span class="lbl">
							{#if e.name}<span class="name">{e.name}</span>{/if}
							{#if e.location}<span class="loc">{e.location}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
			{#if ok.stale}
				<p class="banner" role="note">
					<Icon name="offline" size={18} /><span
						>{t('official.stale', { date: fmtDateTime(ok.readAt) })}</span
					>
				</p>
			{:else}
				<p class="meta">{t('official.read', { date: fmtDateTime(ok.readAt) })}</p>
			{/if}
			<p class="meta">
				<Rich
					text={t('official.source', { operator: source.operator, licence: source.licence })}
					links={{
						src: { href: source.datasetUrl, rel: 'external' },
						lic: { href: source.licenceUrl, rel: 'external' }
					}}
				/>
			</p>
		{:else if result.kind === 'error'}
			<p class="meta" role="status">{t('official.unavailable')}</p>
		{/if}

		{#if ch}
			<details class="report">
				<summary>{t('official.report.title')}</summary>
				<p>{t('official.report.lead')}</p>
				<ul>
					<li>
						<Rich
							text={t('official.report.stations', { operator: source.operator })}
							links={{ a: { href: ch.stationsUrl, rel: 'external' } }}
						/>
					</li>
					<li>
						<Rich
							text={t('official.report.contact', { operator: source.operator })}
							links={{ a: { href: ch.contactUrl, rel: 'external' } }}
						/>
					</li>
					<li>
						<Rich
							text={t('official.report.assistance', {
								name: ch.assistance.name,
								from: ch.assistance.hours[0],
								to: ch.assistance.hours[1]
							})}
							links={{ a: { href: ch.assistance.url, rel: 'external' } }}
						/>
						<span class="phone" translate="no">{ch.assistance.phone}</span>
						<span class="dim">({t('official.report.abroad')}</span>
						<span class="phone" translate="no">{ch.assistance.phoneAbroad}</span><span class="dim"
							>)</span
						>
					</li>
				</ul>
			</details>
		{/if}
	</section>
{/if}

<style>
	.official {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-size: 1.0625rem;
	}
	p {
		margin: 0;
	}
	.summary {
		font-size: 0.9375rem;
	}
	.meta {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.eq {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.eq li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 12px;
		row-gap: 2px;
		padding: 10px 12px;
	}
	.eq li + li {
		border-top: 1px solid var(--border);
	}
	/* État : icône ET texte (jamais la couleur seule), largeur fixe pour aligner les libellés. */
	.st {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: 0 0 8.5rem;
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.st :global(svg) {
		flex-shrink: 0;
		align-self: center;
	}
	.ok .st {
		color: var(--ok);
	}
	.ko .st {
		color: var(--danger);
	}
	.lbl {
		flex: 1 1 12rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow-wrap: anywhere;
	}
	.loc {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.report {
		font-size: 0.9375rem;
	}
	.report summary {
		padding: 10px 0;
		font-weight: 600;
		color: var(--primary);
		cursor: pointer;
	}
	.report ul {
		margin: 8px 0 0;
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.phone {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		user-select: all;
		-webkit-user-select: all;
	}
	.dim {
		color: var(--text-2);
	}
</style>
