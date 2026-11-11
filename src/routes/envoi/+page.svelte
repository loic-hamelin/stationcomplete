<script lang="ts">
	// E8 — Relire et envoyer les saisies d'une gare : un changeset par gare.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { account, configured, login, signedIn } from '#lib/auth.svelte.js';
	import {
		editFamily,
		editIcon,
		editKey,
		editLabel,
		isRemoval,
		type Edit
	} from '#lib/core/edits.js';
	import { openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, pending, removeEdit, updateEdits } from '#lib/edits.svelte.js';
	import {
		APP_VERSION,
		demoRefused,
		sendStation,
		sending,
		type SendResult
	} from '#lib/send.svelte.js';
	import { server, srv } from '#lib/osmserver.svelte.js';
	import { uploadBlock } from '#lib/core/remote.js';
	import { proposedComment } from '#lib/core/upload.js';
	import { refreshConfig, remote } from '#lib/remote.svelte.js';
	import { dequeue, enqueue, isQueued } from '#lib/queue.svelte.js';
	import { findStation, type Station } from '#lib/stations.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { t } from '#lib/i18n/t.js';
	import { onMount } from 'svelte';

	let mounted = $state(false);
	let station = $state<Station | undefined>();
	let online = $state(true);
	let comment = $state('');
	let result = $state<SendResult | undefined>();
	const id = $derived(mounted ? (page.url.searchParams.get('id') ?? '') : '');

	// Description proposée d'après les saisies (motif des suppressions compris), tant que la
	// personne ne l'a pas modifiée.
	let commentEdited = $state(false);
	$effect(() => {
		if (station && pending.loaded && !commentEdited)
			comment = proposedComment(station.name, ready.length ? ready : edits);
	});

	onMount(() => {
		mounted = true;
		online = navigator.onLine;
		const up = () => (online = navigator.onLine);
		addEventListener('online', up);
		addEventListener('offline', up);
		loadEdits();
		refreshConfig();
		findStation(page.url.searchParams.get('id') ?? '').then((s) => (station = s));
		return () => {
			removeEventListener('online', up);
			removeEventListener('offline', up);
		};
	});

	const edits = $derived(id ? editsOf(id) : []);
	const ready = $derived(edits.filter((e) => !e.conflict));
	const review = $derived(edits.filter((e) => e.conflict));
	const busy = $derived(sending.step !== 'idle');
	const real = $derived(server.id === 'prod');
	// Arrêt d'urgence ou phase pilote (config.json) ; revérifié au moment de l'envoi.
	const blocked = $derived(
		!mounted
			? undefined
			: real && ready.some((e) => e.demo)
				? demoRefused()
				: uploadBlock(remote.cfg, APP_VERSION, real && !!account.user, account.user?.name)
	);
	const STEPS = $derived<Record<string, string>>({
		checking: t('sendPage.step.checking'),
		reading: t('sendPage.step.reading'),
		opening: t('sendPage.step.opening'),
		uploading: t('sendPage.step.uploading'),
		closing: t('sendPage.step.closing')
	});
	const icon = (e: Edit) => editIcon(e);
	const family = (e: Edit) => editFamily(e);

	async function send() {
		result = undefined;
		result = await sendStation(id, station?.name ?? id, comment);
		// Données relues après un envoi, ou après un conflit (pour refaire sur la carte à jour).
		if (result.changeset || result.conflicts) openStation(id, { force: true });
	}
	async function retry(e: Edit) {
		// Sans version de référence, la saisie s'appliquera telle quelle à la version à jour.
		// (Jamais pour une forme ou une suppression : elles se refont sur la carte.)
		if (e.kind === 'shape' || isRemoval(e)) return;
		await updateEdits([
			e.kind === 'tags'
				? {
						...e,
						conflict: undefined,
						version: undefined,
						base: undefined,
						// Quai en plusieurs parties : chaque partie aussi, à sa version à jour.
						...(e.parts ? { parts: e.parts.map((p) => ({ target: p.target })) } : {})
					}
				: e.kind === 'node'
					? { ...e, conflict: undefined, wayVersion: undefined }
					: { ...e, conflict: undefined }
		]);
	}
</script>

<svelte:head><title>{t('sendPage.title')}</title></svelte:head>

<div class="screen">
	<header class="head">
		<a class="icon-btn" href={resolve('/contributions')} aria-label={t('sendPage.back')}>
			<Icon name="back" />
		</a>
		<div>
			<h1>{t('contributions.send')}</h1>
			<span class="sub">{station?.name ?? ''}</span>
		</div>
	</header>

	<main>
		{#if !online}
			<p class="banner warn" role="status">
				<Icon name="offline" size={18} />{t('sendPage.offline')}
			</p>
		{/if}
		{#if !srv().canUpload}
			<p class="banner warn" role="note">
				<Icon name="alert" size={18} /><span
					><Rich
						text={t('sendPage.cannotUpload', { server: srv().label })}
						links={{ settings: { href: resolve('/reglages') } }}
					/></span
				>
			</p>
		{:else if real}
			<p class="banner" role="note">
				<Icon name="info" size={18} /><span><Rich text={t('sendPage.prod')} /></span>
			</p>
		{:else}
			<p class="banner" role="note">
				<Icon name="info" size={18} /><span
					><Rich text={t('sendPage.dev', { server: srv().label })} /></span
				>
			</p>
		{/if}
		{#if blocked && srv().canUpload}
			<p class="banner warn" role="alert">{blocked}</p>
		{:else if remote.cfg.message}
			<p class="banner warn" role="note">{remote.cfg.message}</p>
		{/if}

		{#if result?.changeset}
			<div class="banner ok" role="status">
				<Icon name="check" size={18} />
				<div>
					<p>
						<strong>{t('sendPage.sent', { count: result.sent })}</strong>
						{t('sendPage.thanks')}
					</p>
					<a href={`${srv().web}/changeset/${result.changeset}`} rel="external"
						>{t('sendPage.changeset', { id: result.changeset })}</a
					>
				</div>
			</div>
		{/if}
		{#if result?.error}<p class="banner err" role="alert">{result.error}</p>{/if}
		{#if result && !result.error && result.conflicts}
			<p class="banner err" role="alert">
				{t('sendPage.conflicts', { count: result.conflicts })}
			</p>
		{/if}

		{#if !pending.loaded}
			<p class="note" role="status">{t('common.loading')}</p>
		{:else if !edits.length}
			<p class="note">{t('sendPage.empty')}</p>
		{:else}
			{#if ready.length}
				<h2 class="overline">{t('sendPage.ready', { count: ready.length })}</h2>
				<ul class="group">
					{#each ready as e (e.id)}
						<li class={family(e)}>
							<Icon name={icon(e)} size={20} />
							<span class="txt"
								><span class="sum">{e.summary}</span><span class="meta"
									>{editLabel(e)}{e.demo ? ` · ${t('sendPage.demo')}` : ''}</span
								></span
							>
							{#if real && e.demo}
								<span class="acts">
									<button class="btn-sm" type="button" onclick={() => removeEdit(e.id)}
										>{t('contributions.remove')}</button
									>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if review.length}
				<h2 class="overline">{t('sendPage.review', { count: review.length })}</h2>
				<ul class="group">
					{#each review as e (e.id)}
						<li class="review">
							<Icon name="alert" size={20} />
							<span class="txt"
								><span class="sum">{e.summary}</span><span class="meta">{e.conflict}</span></span
							>
							<span class="acts">
								{#if e.kind === 'shape' || isRemoval(e)}
									<!-- Forme ou suppression : jamais renvoyée telle quelle, on la refait sur la carte à jour. -->
									<a
										class="btn-sm"
										href={resolve(`/gare/carte?id=${encodeURIComponent(id)}&focus=${e.target}`)}
										>{t('sendPage.redo')}</a
									>
								{:else}
									<a
										class="btn-sm"
										href={resolve(
											`/gare/saisie?id=${encodeURIComponent(id)}&osm=${e.kind === 'node' ? `way/${e.way}` : editKey(e)}`
										)}>{t('sendPage.open')}</a
									>
									<button class="btn-sm" type="button" onclick={() => retry(e)}
										>{t('sendPage.keep')}</button
									>
								{/if}
								<button class="btn-sm" type="button" onclick={() => removeEdit(e.id)}
									>{t('contributions.remove')}</button
								>
							</span>
						</li>
					{/each}
				</ul>
				<p class="hint">{t('sendPage.keepHint')}</p>
			{/if}

			{#if ready.length && srv().canUpload}
				<label class="field">
					<span>{t('sendPage.comment')}</span>
					<textarea
						class="input"
						rows="3"
						maxlength="255"
						bind:value={comment}
						oninput={() => (commentEdited = true)}></textarea>
				</label>
				<p class="hint">{t('sendPage.commentHint')}</p>
			{/if}
		{/if}
	</main>

	{#if ready.length && srv().canUpload}
		<footer>
			{#if busy}
				<p class="progress" role="status">{STEPS[sending.step] ?? t('sendPage.step.sending')}</p>
			{:else if !configured()}
				<p class="hint">{t('sendPage.notConfigured')}</p>
			{:else if !(mounted && signedIn())}
				<button class="btn" type="button" onclick={() => login()}>{t('sendPage.login')}</button>
			{:else}
				<p class="who">
					<Rich text={t('sendPage.by', { name: account.user?.name ?? t('sendPage.you') })} />
				</p>
				{#if blocked}
					<p class="hint">{t('sendPage.blocked')}</p>
				{:else if isQueued(id)}
					<p class="queued" role="status">
						<Icon name="clock" size={18} />
						{t('sendPage.queued')}
					</p>
					<button class="btn btn-secondary" type="button" onclick={() => dequeue(id)}
						>{t('sendPage.cancelQueue')}</button
					>
				{:else if online}
					<button class="btn" type="button" onclick={send}>
						{t('sendPage.send', { count: ready.length })}
					</button>
				{:else}
					<button
						class="btn"
						type="button"
						onclick={() => enqueue(id, station?.name ?? id, comment)}
					>
						{t('sendPage.sendLater')}
					</button>
				{/if}
			{/if}
		</footer>
	{/if}
</div>

<style>
	.screen {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	main {
		flex-grow: 1;
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
		padding: 12px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.overline {
		margin-bottom: -4px;
	}
	.banner p {
		margin: 0 0 4px;
	}
	.note,
	.hint {
		margin: 0;
		color: var(--text-2);
	}
	.hint {
		font-size: 0.875rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 10px 12px;
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
	li.review {
		flex-wrap: wrap;
	}
	li.review > :global(svg) {
		color: var(--danger);
	}
	.txt {
		flex: 1 1 200px;
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
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-weight: 600;
	}
	.field textarea {
		font-weight: 400;
	}
	.field textarea:focus {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	footer {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: var(--bg);
	}
	footer p {
		margin: 0;
	}
	.who {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.queued {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.queued :global(svg) {
		color: var(--primary);
	}
	.progress {
		font-weight: 600;
		text-align: center;
	}
</style>
