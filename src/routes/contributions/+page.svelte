<script lang="ts">
	// E9 — Mes contributions : saisies en attente d'envoi, regroupées par gare.
	import { resolve } from '$app/paths';
	import BottomNav from '#lib/BottomNav.svelte';
	import Icon from '#lib/Icon.svelte';
	import { editFamily, editIcon, editLabel, type Edit } from '#lib/core/edits.js';
	import { loadEdits, mine, pending, removeEdit } from '#lib/edits.svelte.js';
	import { srv } from '#lib/osmserver.svelte.js';
	import { loadAllStations, type Station } from '#lib/stations.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtDateTime, t } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	let names = $state<Record<string, Station>>({});
	let confirmId = $state('');
	onMount(async () => {
		await loadEdits();
		try {
			const wanted = new Set(mine().map((e) => e.station));
			names = Object.fromEntries(
				(await loadAllStations()).filter((s) => wanted.has(s.id)).map((s) => [s.id, s])
			);
		} catch {
			/* noms des gares indisponibles : on affiche l'identifiant */
		}
	});

	const groups = $derived.by(() => {
		const by: Record<string, Edit[]> = {};
		for (const e of mine()) (by[e.station] ??= []).push(e);
		return Object.entries(by).map(([station, edits]) => ({ station, edits }));
	});
	const icon = (e: Edit) => editIcon(e);
	const when = fmtDateTime;
</script>

<svelte:head><title>{t('contributions.title')}</title></svelte:head>

<div class="screen">
	<main>
		<h1>{t('login.myContributions')}</h1>
		<p class="intro">
			<Rich text={t('contributions.intro', { server: srv().label })} />
		</p>

		{#if !pending.loaded}
			<p class="note" role="status">{t('common.loading')}</p>
		{:else if !groups.length}
			<div class="empty">
				<p>{t('contributions.empty')}</p>
				<a class="btn" href={resolve('/gares')}>{t('home.chooseStation')}</a>
			</div>
		{:else}
			{#each groups as g (g.station)}
				<section>
					<h2>
						<a href={resolve(`/gare?id=${encodeURIComponent(g.station)}`)}
							>{names[g.station]?.name ?? g.station}</a
						>
						<span>{t('contributions.count', { count: g.edits.length })}</span>
					</h2>
					<ul class="group">
						{#each g.edits as e (e.id)}
							<li class={editFamily(e)}>
								<Icon name={icon(e)} size={20} />
								<span class="txt">
									<span class="sum">{e.summary}</span>
									<span class="meta"
										>{editLabel(e)} · {when(e.createdAt)}{#if e.conflict}
											· <span class="review"
												><Icon name="alert" size={14} /> {t('contributions.review')}</span
											>{:else}
											· <span class="wait"
												><Icon name="clock" size={14} /> {t('contributions.waiting')}</span
											>{/if}</span
									>
								</span>
								{#if confirmId === e.id}
									<button class="btn-sm danger" type="button" onclick={() => removeEdit(e.id)}
										>{t('common.confirm')}</button
									>
								{:else}
									<button
										class="btn-sm"
										type="button"
										aria-label={t('contributions.removeLabel', { summary: e.summary })}
										onclick={() => (confirmId = e.id)}>{t('contributions.remove')}</button
									>
								{/if}
							</li>
						{/each}
					</ul>
					<a class="btn send" href={resolve(`/envoi?id=${encodeURIComponent(g.station)}`)}>
						{t('contributions.send')}{#if g.edits.some((e) => e.conflict)}
							· {t('contributions.toReview', {
								count: g.edits.filter((e) => e.conflict).length
							})}{/if}
					</a>
				</section>
			{/each}
		{/if}
	</main>
	<BottomNav current="contributions" />
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
	.intro,
	.note {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--text-2);
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.empty p {
		margin: 0;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h2 {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		margin: 8px 0 0;
		font-size: 1rem;
	}
	h2 span {
		font-size: 0.875rem;
		font-weight: 400;
		color: var(--text-2);
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 8px 8px 8px 12px;
	}
	li > :global(svg) {
		flex-shrink: 0;
		color: var(--voie);
	}
	li.quai > :global(svg) {
		color: var(--quai);
	}
	li.pancarte > :global(svg) {
		color: var(--pancarte);
	}
	li.equip > :global(svg) {
		color: var(--equip);
	}
	.txt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.sum {
		font-weight: 600;
	}
	.meta {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.meta :global(svg) {
		vertical-align: -2px;
	}
	.wait {
		font-weight: 600;
		color: var(--text-2);
	}
	.review {
		font-weight: 600;
		color: var(--missing);
	}
	.btn-sm.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
