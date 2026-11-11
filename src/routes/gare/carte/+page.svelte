<script lang="ts">
	// E5 — Carte de la gare, avec les saisies locales (lot 2).
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { imageryOf } from '#lib/core/countries.js';
	import { newEditId } from '#lib/core/edits.js';
	import type { FeatureProps } from '#lib/core/features.js';
	import { OsmData } from '#lib/core/osm.js';
	import {
		REASONS,
		deleteSummary,
		isLinked,
		platformName,
		platformShape,
		relationsPhrase
	} from '#lib/core/shape.js';
	import {
		SIGN_REASONS,
		signDeleteSummary,
		signRemoval,
		signRemovalPhrase
	} from '#lib/core/sign.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import {
		editsOf,
		editsReplacedByDelete,
		loadEdits,
		pending,
		saveEdit
	} from '#lib/edits.svelte.js';
	import { canSurvey, checkOnSite, where } from '#lib/onsite.svelte.js';
	import { srv } from '#lib/osmserver.svelte.js';
	import { stationView } from '#lib/view.js';
	import StationMap from '#lib/map/StationMap.svelte';
	import { onMount, untrack } from 'svelte';
	import { fmtDistance, t, tk } from '#lib/i18n/t.js';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
	});
	const id = $derived(mounted ? (page.url.searchParams.get('id') ?? '') : '');
	const focus = $derived(mounted ? (page.url.searchParams.get('focus') ?? undefined) : undefined);
	// Vue reprise d'un autre écran (retour de E12 : &z=19.30&c=lon,lat), lue une seule fois.
	const startView = $derived.by(() => {
		if (!mounted) return undefined;
		const z = Number(page.url.searchParams.get('z'));
		const c = (page.url.searchParams.get('c') ?? '').split(',').map(Number);
		return z > 0 && c.length === 2 && c.every(Number.isFinite)
			? { center: [c[0], c[1]] as [number, number], zoom: z }
			: undefined;
	});
	/** Vue courante de la carte, transmise à E12 pour qu'il garde le zoom de l'utilisateur. */
	let mapView = $state<{ center: [number, number]; zoom: number } | undefined>();
	const viewQuery = $derived(
		mapView
			? `&z=${mapView.zoom.toFixed(2)}&c=${mapView.center.map((v) => v.toFixed(7)).join(',')}`
			: ''
	);
	$effect(() => {
		// Ne dépend que de l'identifiant : openStation lit et modifie l'état partagé.
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});

	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	const data = $derived.by(() => {
		if (!view) return undefined;
		const fc = view.features();
		for (const f of fc.features) {
			const p = f.properties;
			// Quai en plusieurs parties : modifié si l'une de ses parties l'est.
			p.edited = view.edited.has(p.osm) || (!!p.part && view.edited.has(p.part));
		}
		return fc;
	});
	const survey = $derived(canSurvey(id));
	// Point de départ du placement d'une pancarte : la voie sélectionnée, sinon le centre de la gare.
	const placeHref = $derived.by(() => {
		const f = data?.features.find((x) => x.properties.osm === selected?.osm);
		const ll =
			f?.anchor ??
			(f?.geometry.type === 'LineString'
				? f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]
				: undefined);
		return resolve(
			`/gare/placer?id=${encodeURIComponent(id)}${ll ? `&lon=${ll[0].toFixed(7)}&lat=${ll[1].toFixed(7)}` : ''}`
		);
	});
	const isLocal = (osm: string) => osm.startsWith('node/-');
	const visible = $state({ quai: true, voie: true, pancarte: true });
	let selected = $state<FeatureProps | undefined>();
	let mapRef = $state<{ locate: () => void; refreshLabels: () => void }>();

	// ---------- Quai existant : forme et suppression (lot 7) ; pancarte : suppression (7d) ----------
	let more = $state(false);
	let deleting = $state(false);
	let reason = $state<'duplicate' | 'gone' | 'misplaced' | undefined>();
	let legend = $state(false);
	let notice = $state('');
	let deleteError = $state('');
	// Quai en plusieurs parties : forme et suppression se font partie par partie.
	let picking = $state<'shape' | 'delete' | undefined>();
	let chosenPart = $state<string | undefined>();
	const select = (p: FeatureProps | undefined) => {
		selected = p;
		more = false;
		picking = undefined;
		chosenPart = undefined;
		deleting = false;
		reason = undefined;
		deleteError = '';
		if (p) notice = '';
	};
	$effect(() => {
		// La feuille grandit (menu, confirmation) : les étiquettes s'écartent d'elle.
		void more;
		void picking;
		void deleting;
		void legend;
		untrack(() => mapRef?.refreshLabels());
	});
	// Quai en plusieurs parties : ses parties (partie principale d'abord), avec leur libellé.
	const group = $derived(
		selected?.kind === 'quai' && selected.parts && view
			? view.analysis.platforms.find((p) => `${p.ref.type}/${p.ref.id}` === selected?.osm)
			: undefined
	);
	const groupParts = $derived(
		(group?.parts ?? []).map((x) => {
			const key = `${x.ref.type}/${x.ref.id}`;
			const label = t(x.covered ? 'map.part.covered' : 'map.part.open', {
				length: fmtDistance(x.lengthM)
			});
			const shape =
				ready && x.ref.type === 'way' && x.ref.id > 0
					? platformShape(new OsmData(ready.elements), x.ref.id)
					: undefined;
			return { key, label, covered: x.covered, shape };
		})
	);
	// Objet visé par la forme et la suppression : la partie choisie, sinon le quai (ou sa partie
	// principale).
	const target = $derived(chosenPart ?? selected?.osm);
	const quaiWay = $derived(
		selected?.kind === 'quai' && target && /^way\/\d+$/.test(target)
			? Number(target.slice(4))
			: undefined
	);
	// Quai tel qu'il est sur OpenStreetMap (données lues) : contour, verrous, relations.
	const shapeOf = $derived(
		ready && quaiWay !== undefined ? platformShape(new OsmData(ready.elements), quaiWay) : undefined
	);
	// Forme affichée (avec vos saisies) : une ligne déjà redessinée se modifie comme une surface.
	const shownClosed = $derived.by(() => {
		const w = view?.elements.find((e) => e.type === 'way' && e.id === quaiWay);
		return !!w && w.type === 'way' && w.nodes.length > 3 && w.nodes[0] === w.nodes.at(-1);
	});
	// Pancarte existante (nœud lu sur OpenStreetMap) : comment la supprimer sans risque.
	const signId = $derived(
		selected?.kind === 'pancarte' && /^node\/\d+$/.test(selected.osm)
			? Number(selected.osm.slice(5))
			: undefined
	);
	const signOf = $derived.by(() => {
		if (!ready || signId === undefined) return undefined;
		const d = new OsmData(ready.elements);
		const n = d.nodes.get(signId);
		if (!n) return undefined;
		const ways = (d.waysOfNode.get(signId) ?? [])
			.map((w) => d.ways.get(w))
			.filter((w) => w !== undefined);
		const rels = [...d.relations.values()].filter((r) =>
			r.members.some((m) => m.type === 'node' && m.ref === signId)
		);
		return { node: n, removal: signRemoval(n, ways, rels, (i) => d.nodes.get(i)) };
	});
	const replaced = $derived(
		deleting && selected && target
			? editsReplacedByDelete(id, target).filter((e) => !e.conflict)
			: []
	);

	async function confirmDelete() {
		deleteError = '';
		if (!shapeOf || !selected || !ready) return;
		// (« Mal placée » n'existe que pour une pancarte.)
		if (!reason || reason === 'misplaced') return (deleteError = t('map.del.chooseReason'));
		if (reason === 'gone' && !survey) return (deleteError = t('map.del.goneOnSite'));
		const part = groupParts.find((x) => x.key === chosenPart);
		// Partie d'un quai en plusieurs parties : nommée comme le quai, avec la partie.
		const name =
			group && part
				? t('map.part.named', {
						name: platformName(group.tags),
						covered: part.covered ? 'yes' : 'no'
					})
				: platformName(shapeOf.way.tags);
		try {
			await saveEdit({
				kind: 'delete',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				target: `way/${shapeOf.way.id}`,
				version: shapeOf.way.version,
				reason,
				before: shapeOf.nodes,
				relations: shapeOf.relations,
				name,
				summary: deleteSummary(name, reason, shapeOf.relations)
			});
			select(undefined);
			notice = t('map.del.pending', { name });
		} catch {
			deleteError = t('common.saveFailed');
		}
	}

	async function confirmSignDelete() {
		deleteError = '';
		if (!signOf || !selected || !ready) return;
		if (!reason) return (deleteError = t('map.del.chooseReason'));
		if (reason === 'gone' && !survey) return (deleteError = t('map.del.goneOnSite'));
		const { node, removal } = signOf;
		const label = selected.label;
		try {
			await saveEdit({
				kind: 'signdelete',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				target: `node/${node.id}`,
				version: node.version,
				...(removal.way !== undefined ? { way: removal.way, wayVersion: removal.wayVersion } : {}),
				reason,
				mode: removal.mode,
				untag: removal.untag,
				label,
				summary: signDeleteSummary(label, reason, removal.mode)
			});
			select(undefined);
			notice = t('map.del.pending', { name: t('sign.named', { label }) });
		} catch {
			deleteError = t('common.saveFailed');
		}
	}

	/** Constat d'une quête sur la fiche d'un objet (Q1 à Q7), dans la langue de l'interface. */
	const questText = (q: string) =>
		// Quai en plusieurs parties : parties aux numéros différents, ou sans numéro.
		q === 'Q3' && group?.mixed
			? t('map.quest.mixed')
			: q === 'Q1' && group?.missingRef
				? t('map.quest.partial', { count: group.missingRef })
				: /^Q[1-7]$/.test(q)
					? tk(`map.quest.${q}`)
					: q;
	// Constats de la feuille basse : une icône par nature (alerte, à relever, à vérifier).
	const QUEST_ICON: Record<string, 'alert' | 'question' | 'clock'> = {
		Q3: 'alert',
		Q7: 'alert',
		Q6: 'clock'
	};
	/** Légende de la carte (lot 7d) : pointillés réservés aux objets souterrains. */
	const LEGEND = ['quai', 'voie', 'pancarte', 'sel', 'edited', 'under', 'todo', 'alert'] as const;
	const filters = $derived([
		{ k: 'quai', label: t('station.gauge.platforms') },
		{ k: 'voie', label: t('station.gauge.tracks') },
		{ k: 'pancarte', label: t('station.gauge.signs') }
	] as const);
	const quoted = (list: { summary: string }[]) =>
		list.map((e) => t('common.quoted', { text: e.summary })).join(', ');
</script>

<svelte:window onkeydown={(e) => legend && e.key === 'Escape' && (legend = false)} />

<svelte:head
	><title>{t('map.title', { name: ready?.station.name ?? t('nav.station') })}</title></svelte:head
>

<!-- Carte plein écran ; barre, filtres, boutons et feuille basse flottent au-dessus. -->
<div class="screen" data-map-scope>
	{#if ready && data}
		<StationMap
			bind:this={mapRef}
			imagery={imageryOf(ready.station.country)}
			bbox={ready.station.bbox}
			{data}
			{visible}
			{focus}
			view={startView}
			selected={selected?.osm}
			onselect={select}
			onview={(center, zoom) => (mapView = { center, zoom })}
		/>
	{/if}

	<div class="top">
		<div class="bar float" data-map-avoid>
			<a
				class="icon-btn"
				href={resolve(`/gare?id=${encodeURIComponent(id)}`)}
				aria-label={t('map.back')}
			>
				<Icon name="back" size={22} />
			</a>
			<h1>{ready?.station.name ?? t('station.view.map')}</h1>
			{#if ready}
				<button
					class="where"
					class:on={survey}
					type="button"
					onclick={() => checkOnSite(ready.station)}
				>
					{#if survey}<span class="live" aria-hidden="true"></span>{:else}<Icon
							name="lock"
							size={16}
						/>{/if}
					{survey
						? t('map.onSite')
						: where.status === 'checking'
							? t('stations.locating')
							: t('map.remote')}
					<span class="visually-hidden">{t('map.checkPosition')}</span>
				</button>
			{/if}
		</div>
		<div class="row2">
			<div class="filters" role="group" aria-label={t('map.filters')}>
				{#each filters as f (f.k)}
					<button
						type="button"
						class="chip {f.k}"
						data-map-avoid
						aria-pressed={visible[f.k]}
						onclick={() => (visible[f.k] = !visible[f.k])}
					>
						<span class="pict" aria-hidden="true"></span>{f.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="legend-btn"
				data-map-avoid
				aria-label={t('map.legend.open')}
				aria-expanded={legend}
				aria-controls="legende"
				onclick={() => (legend = !legend)}><Icon name="info" size={20} /></button
			>
		</div>
		{#if legend}
			<!-- Légende (lot 7d) : panneau flottant refermable, au-dessus des repères de la carte. -->
			<section id="legende" class="legend float" aria-labelledby="legende-titre" data-map-avoid>
				<div class="legend-head">
					<h2 id="legende-titre">{t('map.legend.title')}</h2>
					<button
						class="icon-btn"
						type="button"
						aria-label={t('map.legend.close')}
						onclick={() => (legend = false)}><Icon name="close" size={20} /></button
					>
				</div>
				<ul>
					{#each LEGEND.map((k) => ({ k })) as item (item.k)}
						<li>
							<svg class="sw" width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
								<rect width="40" height="24" rx="3" fill="#6b665c" />
								{#if item.k === 'quai'}
									<rect
										x="6"
										y="6"
										width="28"
										height="12"
										fill="#B5EDE4"
										fill-opacity=".35"
										stroke="#14110E"
										stroke-width="3"
									/>
									<rect
										x="6"
										y="6"
										width="28"
										height="12"
										fill="none"
										stroke="#B5EDE4"
										stroke-width="1.5"
									/>
								{:else if item.k === 'voie' || item.k === 'sel' || item.k === 'edited' || item.k === 'under'}
									{@const c =
										item.k === 'sel' ? '#FFF700' : item.k === 'edited' ? '#B3C8FF' : '#E4E0FF'}
									{#if item.k === 'sel'}<path
											d="M5 12h30"
											stroke="#FFF700"
											stroke-opacity=".35"
											stroke-width="9"
											stroke-linecap="round"
										/>{/if}
									<path
										d="M5 12h30"
										stroke="#14110E"
										stroke-opacity={item.k === 'under' ? 0.3 : 0.7}
										stroke-width="4.5"
										stroke-linecap="round"
									/>
									<path
										d="M5 12h30"
										stroke={c}
										stroke-width="2.5"
										stroke-opacity={item.k === 'under' ? 0.6 : 1}
										stroke-dasharray={item.k === 'under' ? '3 3' : undefined}
									/>
									{#if item.k === 'edited'}<circle
											cx="20"
											cy="12"
											r="3.5"
											fill="#B3C8FF"
											stroke="#14110E"
										/>{/if}
								{:else if item.k === 'pancarte'}
									<path d="M20 13v8" stroke="#14110E" stroke-width="1.5" />
									<rect x="12" y="3" width="16" height="10" rx="1" fill="#fff" stroke="#14110E" />
								{:else}
									<rect x="8" y="3" width="24" height="18" rx="2" fill="rgb(31 27 23 / .86)" />
									{#if item.k === 'todo'}
										<text
											x="20"
											y="16.5"
											text-anchor="middle"
											fill="#ffe08a"
											font-size="12"
											font-weight="600">?</text
										>
									{:else}
										<circle cx="20" cy="12" r="6" fill="#ff6a5c" />
										<text
											x="20"
											y="16"
											text-anchor="middle"
											fill="#1f1b17"
											font-size="10"
											font-weight="600">!</text
										>
									{/if}
								{/if}
							</svg>
							<span>{tk(`map.legend.${item.k}`)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	{#if st.status === 'loading' || !mounted}
		<p class="status float" role="status">{t('map.loading')}</p>
	{:else if st.status === 'error'}
		<p class="status float error" role="alert">
			<Icon name="alert" size={20} />{st.message}
		</p>
	{/if}

	{#if notice && !selected}
		<p class="notice float" role="status">
			<Icon name="check" size={18} /><span>{notice}</span>
			<a href={resolve('/contributions')}>{t('login.myContributions')}</a>
		</p>
	{/if}

	{#if ready && !selected}
		<button
			class="locate float"
			type="button"
			data-map-avoid
			aria-label={t('map.locate')}
			onclick={() => mapRef?.locate()}
		>
			<Icon name="locate" size={20} />
		</button>
		<a class="add" href={placeHref} data-map-avoid
			><Icon name="plus" size={20} />{t('map.addSign')}</a
		>
	{/if}

	{#if selected}
		<section class="sheet" aria-live="polite" aria-label={t('map.legend.sel')} data-map-avoid>
			<div class="sheet-head">
				<span class="fam {selected.kind}"><Icon name={selected.kind} size={20} /></span>
				<div class="titles">
					<h2>{selected.title}</h2>
					<p>{selected.detail}</p>
				</div>
				<button
					class="icon-btn"
					type="button"
					aria-label={t('common.close')}
					onclick={() => select(undefined)}
				>
					<Icon name="close" size={20} />
				</button>
			</div>
			{#if selected.quests || selected.edited}
				<ul class="facts">
					{#each (selected.quests ? selected.quests.split(',') : []).slice(0, 3) as q (q)}
						{@const ico = QUEST_ICON[q] ?? 'question'}
						<li class={ico}><Icon name={ico} size={18} />{questText(q)}</li>
					{/each}
					{#if selected.edited}
						<li class="edited">
							<Icon name="send" size={18} />{t('map.editedHere')}
						</li>
					{/if}
				</ul>
			{/if}
			{#if deleting && signOf}
				<div class="confirm">
					<h3>{t('map.del.signTitle')}</h3>
					<fieldset>
						<legend>{t('map.del.reason')}</legend>
						<label class="choice">
							<input type="radio" name="motif" value="duplicate" bind:group={reason} />
							{SIGN_REASONS.duplicate}
						</label>
						<label class="choice">
							<input type="radio" name="motif" value="misplaced" bind:group={reason} />
							{SIGN_REASONS.misplaced}
						</label>
						<label class="choice" class:off={!survey}>
							<input
								type="radio"
								name="motif"
								value="gone"
								disabled={!survey}
								aria-describedby="gone-hint"
								bind:group={reason}
							/>
							{SIGN_REASONS.gone}
						</label>
						<p id="gone-hint" class="hint">
							{#if survey}{t('map.del.seenOnSite')}{:else}<Icon name="lock" size={14} />
								{t('map.del.onSiteOnly')}{/if}
						</p>
					</fieldset>
					<ul class="facts">
						<li class="info">
							<Icon name="info" size={18} />{signRemovalPhrase(signOf.removal)}
						</li>
						{#if replaced.length}
							<li class="alert">
								<Icon name="alert" size={18} />{t('map.del.signReplaced', {
									list: quoted(replaced)
								})}
							</li>
						{/if}
					</ul>
					{#if deleteError}<p class="banner err" role="alert">{deleteError}</p>{/if}
					<div class="actions">
						<button class="btn-sm" type="button" onclick={() => (deleting = false)}
							>{t('common.cancel')}</button
						>
						<button class="btn-sm danger" type="button" onclick={confirmSignDelete}
							><Icon name="trash" size={18} />{t('map.del.signButton')}</button
						>
					</div>
				</div>
			{:else if deleting && shapeOf}
				{@const lost = shapeOf.nodes.filter((n) => !isLinked(n)).length}
				{@const kept = shapeOf.nodes.length - lost}
				<div class="confirm">
					<h3>{t('map.del.platformTitle')}</h3>
					{#if shapeOf.refused || shapeOf.deleteRefused}
						<p class="banner err" role="alert">
							<Icon name="alert" size={18} />{shapeOf.refused ?? shapeOf.deleteRefused}
						</p>
					{:else}
						<fieldset>
							<legend>{t('map.del.reason')}</legend>
							<label class="choice">
								<input type="radio" name="motif" value="duplicate" bind:group={reason} />
								{REASONS.duplicate}
							</label>
							<label class="choice" class:off={!survey}>
								<input
									type="radio"
									name="motif"
									value="gone"
									disabled={!survey}
									aria-describedby="gone-hint"
									bind:group={reason}
								/>
								{REASONS.gone}
							</label>
							<p id="gone-hint" class="hint">
								{#if survey}{t('map.del.seenOnSite')}{:else}<Icon name="lock" size={14} />
									{t('map.del.onSiteOnly')}{/if}
							</p>
						</fieldset>
						<ul class="facts">
							{#if chosenPart}
								<li class="info">
									<Icon name="info" size={18} />{t('map.del.partOnly', {
										part: groupParts.find((x) => x.key === chosenPart)?.label ?? ''
									})}
								</li>
							{/if}
							{#if shapeOf.relations.length}
								<li class="info">
									<Icon name="info" size={18} />{t('map.del.relations', {
										phrase: relationsPhrase(shapeOf.relations)
									})}
								</li>
							{/if}
							<li class="info">
								<Icon name="info" size={18} />{t('map.del.points', { lost, kept })}
							</li>
							{#if replaced.length}
								<li class="alert">
									<Icon name="alert" size={18} />{t('map.del.platformReplaced', {
										list: quoted(replaced)
									})}
								</li>
							{/if}
						</ul>
					{/if}
					{#if deleteError}<p class="banner err" role="alert">{deleteError}</p>{/if}
					<div class="actions">
						<button class="btn-sm" type="button" onclick={() => (deleting = false)}
							>{t('common.cancel')}</button
						>
						{#if !shapeOf.refused && !shapeOf.deleteRefused}
							<button class="btn-sm danger" type="button" onclick={confirmDelete}
								><Icon name="trash" size={18} />{t('map.del.platformButton')}</button
							>
						{:else}
							<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
								{t('common.seeOnOsm')}<Icon name="ext" size={16} />
							</a>
						{/if}
					</div>
				</div>
			{:else}
				<div class="actions">
					{#if isLocal(selected.osm)}
						<a class="btn-sm" href={resolve('/contributions')}>{t('map.seeContributions')}</a>
					{:else if selected.away}
						<!-- Voie qui ne longe aucun quai (lot 7d) : fiche simple, jamais supprimable. -->
						<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
							{t('common.seeOnOsm')}<Icon name="ext" size={16} />
						</a>
					{:else}
						<a
							class="btn-sm renseigner"
							href={resolve(`/gare/saisie?id=${encodeURIComponent(id)}&osm=${selected.osm}`)}
							><Icon name="pen" size={18} />{t('map.fill')}</a
						>
						{#if selected.kind === 'voie'}
							<a class="btn-quiet" href={placeHref}>{t('map.signHere')}</a>
						{/if}
						{#if selected.kind === 'quai'}
							{#if groupParts.length}
								<button
									class="btn-quiet"
									type="button"
									aria-expanded={picking === 'shape'}
									aria-controls="part-menu"
									onclick={() => {
										more = false;
										picking = picking === 'shape' ? undefined : 'shape';
									}}><Icon name="shape" size={18} />{t('map.reshape')}</button
								>
							{:else if shapeOf && !shapeOf.refused}
								<a
									class="btn-quiet"
									href={resolve(
										`/gare/forme?id=${encodeURIComponent(id)}&osm=${selected.osm}${viewQuery}`
									)}
									><Icon name="shape" size={18} />{shownClosed
										? t('map.reshape')
										: t('map.toArea')}</a
								>
							{/if}
							<button
								class="icon-btn more"
								type="button"
								aria-label={t('map.more')}
								aria-expanded={more}
								aria-controls="more-menu"
								onclick={() => {
									picking = undefined;
									more = !more;
								}}><Icon name="more" size={20} /></button
							>
						{:else if selected.kind === 'pancarte'}
							<button
								class="icon-btn more"
								type="button"
								aria-label={t('map.more')}
								aria-expanded={more}
								aria-controls="more-menu"
								onclick={() => (more = !more)}><Icon name="more" size={20} /></button
							>
						{:else}
							<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
								{t('common.seeOnOsm')}<Icon name="ext" size={16} />
							</a>
						{/if}
					{/if}
				</div>
				{#if more && selected.kind === 'pancarte'}
					<ul class="menu" id="more-menu">
						{#if signOf}
							<li>
								<button class="btn-quiet danger" type="button" onclick={() => (deleting = true)}
									><Icon name="trash" size={18} />{t('map.deleteSign')}</button
								>
							</li>
						{/if}
						<li>
							<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
								{t('common.seeOnOsm')}<Icon name="ext" size={16} />
							</a>
						</li>
					</ul>
				{/if}
				{#if picking && groupParts.length}
					<!-- Quai en plusieurs parties : la forme et la suppression visent une partie. -->
					<div class="menu parts" id="part-menu">
						<p class="pick" id="part-menu-title">{t('map.part.choose')}</p>
						<ul aria-labelledby="part-menu-title">
							{#each groupParts as x (x.key)}
								<li>
									{#if picking === 'shape' && x.shape && !x.shape.refused}
										<a
											class="btn-quiet"
											href={resolve(
												`/gare/forme?id=${encodeURIComponent(id)}&osm=${x.key}${viewQuery}`
											)}><Icon name="shape" size={18} />{x.label}</a
										>
									{:else if picking === 'delete' && x.shape && !x.shape.refused}
										<button
											class="btn-quiet danger"
											type="button"
											onclick={() => {
												chosenPart = x.key;
												picking = undefined;
												deleting = true;
											}}><Icon name="trash" size={18} />{x.label}</button
										>
									{:else}
										<p class="note">
											<Icon name="info" size={18} />{x.label} : {x.shape?.refused ??
												t('shape.complex')}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if more && selected.kind === 'quai' && groupParts.length}
					<ul class="menu" id="more-menu">
						<li>
							<button
								class="btn-quiet danger"
								type="button"
								onclick={() => {
									more = false;
									picking = 'delete';
								}}><Icon name="trash" size={18} />{t('map.deletePlatform')}</button
							>
						</li>
						<li>
							<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
								{t('common.seeOnOsm')}<Icon name="ext" size={16} />
							</a>
						</li>
					</ul>
				{:else if more && selected.kind === 'quai'}
					<ul class="menu" id="more-menu">
						{#if shapeOf?.refused || !shapeOf}
							<li class="note">
								<Icon name="info" size={18} />{shapeOf?.refused ??
									(selected.osm.startsWith('way/-') ? t('map.drawnHere') : t('shape.complex'))}
							</li>
						{:else}
							<li>
								<button class="btn-quiet danger" type="button" onclick={() => (deleting = true)}
									><Icon name="trash" size={18} />{t('map.deletePlatform')}</button
								>
							</li>
						{/if}
						<li>
							<a class="btn-quiet osm" href={`${srv().web}/${selected.osm}`} rel="external">
								{t('common.seeOnOsm')}<Icon name="ext" size={16} />
							</a>
						</li>
					</ul>
				{/if}
			{/if}
		</section>
	{/if}
</div>

<style>
	.screen {
		position: relative;
		height: 100dvh;
		overflow: hidden;
		background: #8c877c;
	}
	.top {
		position: absolute;
		top: calc(8px + env(safe-area-inset-top));
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		display: flex;
		flex-direction: column;
		gap: 2px;
		pointer-events: none;
	}
	.top > * {
		pointer-events: auto;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 2px;
		min-height: 48px;
		padding: 0 4px 0 0;
	}
	h1 {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.where {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-2);
		font: 600 0.875rem/1.2 var(--font);
		cursor: pointer;
	}
	.where.on {
		color: var(--ok);
	}
	.live {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}
	.row2 {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 6px;
		pointer-events: none;
	}
	.filters {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-self: flex-start;
		pointer-events: none;
	}
	/* Bouton de légende : visuel rond de 32 px, zone tactile de 44 px. */
	.legend-btn {
		flex-shrink: 0;
		position: relative;
		isolation: isolate;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		background: none;
		color: var(--text);
		cursor: pointer;
		pointer-events: auto;
	}
	.legend-btn::before {
		content: '';
		position: absolute;
		inset: 6px;
		z-index: -1;
		border: 1px solid var(--overlay-line);
		border-radius: 50%;
		background: var(--overlay);
		box-shadow: var(--shadow-float);
	}
	.legend-btn[aria-expanded='true']::before {
		border-color: var(--primary);
	}
	.legend {
		align-self: flex-end;
		width: min(300px, 100%);
		margin-top: 2px;
		padding: 4px 4px 8px 12px;
	}
	.legend-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.legend h2 {
		font-size: 1rem;
	}
	.legend ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.9375rem;
		line-height: 1.3;
	}
	.sw {
		flex-shrink: 0;
	}
	/* Puce : visuel 32 px, zone tactile 44 px (marge transparente). */
	.chip {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding: 6px 0;
		border: 0;
		background: none;
		color: var(--text);
		font: 600 0.875rem/1 var(--font);
		cursor: pointer;
		pointer-events: auto;
		position: relative;
		isolation: isolate;
		gap: 6px;
		padding-inline: 12px;
	}
	.chip::before {
		content: '';
		position: absolute;
		inset: 6px 0;
		z-index: -1;
		border: 1px solid var(--overlay-line);
		border-radius: var(--radius-pill);
		background: var(--overlay);
		box-shadow: var(--shadow-float);
	}
	.chip[aria-pressed='false'] {
		color: var(--text-2);
	}
	.chip[aria-pressed='false']::before {
		border: 1px dashed var(--border-strong);
		box-shadow: none;
	}
	.pict {
		flex-shrink: 0;
		box-sizing: border-box;
	}
	.chip.quai .pict {
		width: 12px;
		height: 8px;
		border: 1.5px solid var(--quai);
		border-radius: 1px;
		background: var(--quai-soft);
	}
	.chip.voie .pict {
		width: 14px;
		height: 3px;
		border-radius: 2px;
		background: var(--voie);
	}
	.chip.pancarte .pict {
		width: 9px;
		height: 9px;
		border: 1.5px solid var(--pancarte);
		border-radius: 1px;
		background: var(--bg);
	}
	.chip[aria-pressed='false'] .pict {
		opacity: 0.35;
	}
	.status {
		position: absolute;
		inset: 45% 16px auto;
		margin: 0;
		padding: 12px 14px;
		display: flex;
		gap: 8px;
		justify-content: center;
		text-align: center;
	}
	.status.error :global(svg) {
		flex-shrink: 0;
		color: var(--danger);
	}
	.locate {
		position: absolute;
		left: calc(12px + env(safe-area-inset-left));
		bottom: calc(32px + env(safe-area-inset-bottom));
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		cursor: pointer;
	}
	.add {
		position: absolute;
		right: calc(12px + env(safe-area-inset-right));
		bottom: calc(32px + env(safe-area-inset-bottom));
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 16px 0 12px;
		border-radius: 22px;
		background: var(--primary);
		color: var(--on-primary);
		font-weight: 600;
		font-size: 0.9375rem;
		text-decoration: none;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.28);
	}
	/* Feuille basse compacte (décision 5) : titre, 1 à 3 constats, un seul bouton discret. */
	.sheet {
		position: absolute;
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		bottom: calc(24px + env(safe-area-inset-bottom)); /* au-dessus de l'attribution */
		max-width: 560px;
		margin: 0 auto;
		padding: 8px 8px 6px 12px;
		border: 1px solid var(--overlay-line);
		border-radius: var(--radius-sheet);
		background: var(--bg);
		box-shadow: var(--shadow-sheet);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sheet-head {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.titles {
		flex-grow: 1;
		min-width: 0;
		padding-top: 4px;
	}
	.fam {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		margin-top: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius);
		background: var(--quai-soft);
		color: var(--quai);
	}
	.fam.voie {
		background: var(--voie-soft);
		color: var(--voie);
	}
	.fam.pancarte {
		background: var(--pancarte-soft);
		color: var(--pancarte);
	}
	h2 {
		margin: 0;
		font-size: 1.125rem;
		line-height: 1.3;
	}
	.titles p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.facts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.9375rem;
		line-height: 1.35;
	}
	.facts li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.facts :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--missing);
	}
	.facts .alert :global(svg) {
		color: var(--danger);
	}
	.facts .clock :global(svg),
	.facts .edited :global(svg) {
		color: var(--text-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
	}
	.renseigner {
		padding: 0 14px 0 10px;
		border-color: var(--primary);
		color: var(--primary);
	}
	.btn-quiet {
		padding: 0 6px;
	}
	.more {
		width: 44px;
		height: 44px;
		margin-left: auto;
		color: var(--text-2);
	}
	/* Menu « Plus d'actions » : liste discrète sous les actions (lot 7). */
	.menu {
		list-style: none;
		margin: 0;
		padding: 2px 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.menu .note {
		display: flex;
		gap: 8px;
		padding: 8px 6px;
		font-size: 0.9375rem;
	}
	.menu .note :global(svg) {
		flex-shrink: 0;
		color: var(--text-2);
	}
	/* Quai en plusieurs parties : « Quelle partie ? » puis une ligne par partie. */
	.parts ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pick {
		margin: 0;
		padding: 6px 6px 0;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.btn-quiet.danger {
		color: var(--danger);
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
		border-top: 1px solid var(--border);
	}
	h3 {
		margin: 4px 0 0;
		font-size: 1rem;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
	}
	legend {
		padding: 0;
		margin-bottom: 2px;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-size: 0.9375rem;
		cursor: pointer;
	}
	.choice input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--primary);
	}
	.choice.off {
		color: var(--text-2);
		cursor: default;
	}
	.hint {
		margin: 0 0 0 30px;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.facts .info :global(svg) {
		color: var(--text-2);
	}
	.btn-sm.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	.notice {
		position: absolute;
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		bottom: calc(88px + env(safe-area-inset-bottom));
		max-width: 560px;
		margin: 0 auto;
		padding: 10px 12px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		font-size: 0.9375rem;
	}
	.notice :global(svg) {
		color: var(--ok);
	}
	.notice span {
		flex: 1 1 200px;
	}
</style>
