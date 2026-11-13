<script lang="ts">
	// E12 — Modifier la forme d'un quai existant, ou redessiner en surface un quai tracé en
	// ligne (lot 7). Même carte que E11 : croix fixe, carte qui glisse, pavé de flèches.
	// Le way garde son identifiant. Un point partagé avec d'autres objets peut être déplacé
	// (lot 7c) : c'est le même nœud, ils suivent — l'appli le dit avant ; retiré, il quitte
	// seulement ce quai. La vue (centre, zoom) vient de la carte de la gare et y retourne.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { imageryOf } from '#lib/core/countries.js';
	import {
		checkShape,
		lostTracks,
		lostTracksMessage,
		ringTracks,
		snapNear,
		type LonLat
	} from '#lib/core/draw.js';
	import { newEditId, type RingNode, type ShapeEdit } from '#lib/core/edits.js';
	import {
		OsmData,
		isPlatform,
		isRail,
		isUnderground,
		type OsmNode,
		type OsmWay
	} from '#lib/core/osm.js';
	import {
		checkLocks,
		followers,
		followersPhrase,
		isFixed,
		isLinked,
		linkName,
		listFr,
		platformName,
		platformShape,
		pointInfo,
		samePlace,
		sharedLabel,
		shareNotice,
		shapeSummary
	} from '#lib/core/shape.js';
	import Rich from '#lib/i18n/Rich.svelte';
	import { fmtDecimal, fmtDistance, t } from '#lib/i18n/t.js';
	import { current, openStation } from '#lib/current.svelte.js';
	import { editsOf, loadEdits, nextTempId, pending, saveEdit } from '#lib/edits.svelte.js';
	import DrawMap from '#lib/map/DrawMap.svelte';
	import NudgePad from '#lib/map/NudgePad.svelte';
	import { srv } from '#lib/osmserver.svelte.js';
	import { loadSnapPref, setSnapPref, snapPref } from '#lib/snap.svelte.js';
	import { stationView } from '#lib/view.js';
	import { onMount, untrack } from 'svelte';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		loadEdits();
		loadSnapPref();
	});
	const id = $derived(mounted ? (page.url.searchParams.get('id') ?? '') : '');
	const osm = $derived(mounted ? (page.url.searchParams.get('osm') ?? '') : '');
	const wayId = $derived(/^way\/\d+$/.test(osm) ? Number(osm.slice(4)) : undefined);
	// Vue de la carte de la gare (E5) au moment d'ouvrir cet écran : reprise telle quelle.
	const startView = $derived.by(() => {
		if (!mounted) return undefined;
		const z = Number(page.url.searchParams.get('z'));
		const c = (page.url.searchParams.get('c') ?? '').split(',').map(Number);
		return z > 0 && c.length === 2 && c.every(Number.isFinite)
			? { center: [c[0], c[1]] as LonLat, zoom: z }
			: undefined;
	});
	$effect(() => {
		const gare = id;
		if (gare) untrack(() => openStation(gare));
	});

	const st = $derived(current.value);
	const ready = $derived(st.status === 'ready' && st.station.id === id ? st : undefined);
	const view = $derived(
		ready && pending.loaded ? stationView(ready.station, ready.elements, editsOf(id)) : undefined
	);
	// Quai tel qu'il est sur OpenStreetMap (données lues) : nœuds d'origine et verrous.
	const info = $derived(
		ready && wayId !== undefined ? platformShape(new OsmData(ready.elements), wayId) : undefined
	);
	const isQuai = $derived(!!info && isPlatform(info.way.tags));
	// Saisie de forme déjà en attente sur ce quai (on la reprend), sauf si elle est « à revoir ».
	const previous = $derived(
		pending.loaded
			? (editsOf(id).find((e) => e.kind === 'shape' && e.target === osm && !e.conflict) as
					ShapeEdit | undefined)
			: undefined
	);
	const mode = $derived<'reshape' | 'area'>(
		previous?.mode ?? (info && !info.closed ? 'area' : 'reshape')
	);
	const name = $derived(platformName(info?.way.tags));
	let centerNow = $state<LonLat | undefined>();
	let zoomNow = $state<number | undefined>();
	// Retour à la carte de la gare avec la vue de cet écran (centre et zoom).
	const back = $derived(
		resolve(
			`/gare/carte?id=${encodeURIComponent(id)}&focus=${osm}${centerNow && zoomNow ? `&z=${zoomNow.toFixed(2)}&c=${centerNow.map((v) => v.toFixed(7)).join(',')}` : ''}`
		)
	);

	const nodes = $derived(
		new Map(
			(view?.elements ?? [])
				.filter((e): e is OsmNode => e.type === 'node')
				.map((n) => [n.id, n] as [number, OsmNode])
		)
	);
	const coords = (w: OsmWay) =>
		w.nodes
			.map((i) => nodes.get(i))
			.filter((n): n is OsmNode => !!n)
			.map((n) => [n.lon, n.lat] as LonLat);
	const railWays = $derived(
		(view?.elements ?? []).filter((e): e is OsmWay => e.type === 'way' && isRail(e.tags))
	);
	const trackLines = $derived(railWays.map(coords));
	const tracksUnder = $derived(railWays.map((w) => isUnderground(w.tags)));
	// Le quai lui-même est exclu du contrôle de chevauchement.
	const platformWays = $derived(
		(view?.elements ?? []).filter(
			(e): e is OsmWay => e.type === 'way' && isPlatform(e.tags) && e.id !== wayId
		)
	);
	const platformRings = $derived(platformWays.map(coords));
	const platformsUnder = $derived(platformWays.map((w) => isUnderground(w.tags)));

	// ---------- Contour en cours ----------
	let pts = $state<RingNode[]>([]);
	let history = $state<RingNode[][]>([]);
	let selected = $state<number | undefined>();
	/** Dernière action et ses conséquences, affichée en clair (« il reste dans la gare »). */
	let lastNote = $state('');
	let errors = $state<string[]>([]);
	let said = $state('');
	let saving = $state(false);
	let mapRef = $state<{
		nudge: (dx: number, dy: number) => void;
		zoom: (d: number) => void;
		centerOn: (p: LonLat) => void;
		fromCross: (p: LonLat) => { x: number; y: number } | undefined;
	}>();
	let noticeClosed = $state(false);

	let initFor = '';
	$effect(() => {
		// Point de départ, une seule fois : saisie en attente, sinon contour actuel (vide pour
		// une ligne à redessiner en surface).
		if (!info || !pending.loaded || initFor === osm) return;
		initFor = osm;
		untrack(() => {
			pts = previous
				? previous.nodes.map((n) => ({ ...n }))
				: info.closed
					? info.nodes.map(({ id, lon, lat }) => ({ id, lon, lat }))
					: [];
		});
	});

	const orig = $derived(new Map((info?.nodes ?? []).map((n) => [n.id, n])));
	// Fixe : point répété dans le contour, ou point relié en « redessiner en surface ».
	const locked = $derived(
		pts.map((p) => {
			const o = orig.get(p.id);
			return !!o && isFixed(o, mode);
		})
	);
	// Partagé avec d'autres objets : déplaçable (ils suivent) ; retiré, il quitte le quai seul.
	const shared = $derived(
		pts.map((p, i) => {
			const o = orig.get(p.id);
			return !!o && !locked[i] && isLinked(o);
		})
	);
	// Partagé avec un bord de quai : déplaçable, jamais retiré.
	const edge = $derived(pts.map((p) => mode === 'reshape' && !!orig.get(p.id)?.edge));
	const linksOf = (i: number) =>
		listFr((orig.get(pts[i]?.id)?.links ?? ['autre objet']).map(linkName));
	const notice = $derived(info && !noticeClosed ? shareNotice(info.nodes) : '');
	/** Sommet lisible au lecteur d'écran : ce qu'il partage, ou la raison du verrou. */
	const vertexLabel = (i: number) =>
		locked[i]
			? t('shapePage.vertex.locked', { n: i + 1, links: linksOf(i) })
			: shared[i]
				? t('shapePage.vertex.shared', { n: i + 1, what: sharedLabel(orig.get(pts[i].id)!) })
				: t('shapePage.vertex.plain', { n: i + 1 });
	const ring = $derived(pts.map((p) => [p.lon, p.lat] as LonLat));
	/**
	 * Accrochage au bord de voie (lot 7d) : seulement si le point accroché est à moins de 12 px
	 * de la croix au zoom courant (et l'axe à moins de 4 m), et si l'accrochage est activé.
	 */
	const snapAt = (p: LonLat) =>
		snapPref.on && zoomNow !== undefined
			? snapNear(p, railWays, (i) => nodes.get(i), zoomNow)
			: undefined;
	const snap = $derived(centerNow ? snapAt(centerNow) : undefined);
	const preview = $derived(centerNow ? (snap?.point ?? centerNow) : undefined);
	const check = $derived(checkShape(ring, trackLines, platformRings));
	const bounds = $derived.by((): [LonLat, LonLat] | undefined => {
		if (!info?.nodes.length) return undefined;
		const lons = info.nodes.map((n) => n.lon),
			lats = info.nodes.map((n) => n.lat);
		return [
			[Math.min(...lons), Math.min(...lats)],
			[Math.max(...lons), Math.max(...lats)]
		];
	});
	// Redessiner en surface : points reliés de l'ancienne ligne, à reprendre dans le contour.
	const anchorNodes = $derived(
		mode === 'area'
			? (info?.nodes ?? []).filter((n) => isFixed(n, 'area') && !pts.some((p) => p.id === n.id))
			: []
	);
	const anchors = $derived(
		anchorNodes.map((n) => ({
			at: [n.lon, n.lat] as LonLat,
			label: t('shapePage.anchor', { n: info!.nodes.indexOf(n) + 1 })
		}))
	);
	const guide = $derived(
		mode === 'area' && info ? info.nodes.map((n) => [n.lon, n.lat] as LonLat) : undefined
	);
	const sel = $derived(selected !== undefined ? pts[selected] : undefined);
	const selLocked = $derived(selected !== undefined && locked[selected]);
	const selEdge = $derived(selected !== undefined && edge[selected]);
	/** Ce qui suivra le déplacement du point sélectionné, et ce que ferait son retrait. */
	const selInfo = $derived(
		selected !== undefined && shared[selected]
			? pointInfo(orig.get(pts[selected].id))
			: { move: '', remove: '' }
	);
	/** Rayon de prise à la croix, à l'écran (px). */
	const PICK_PX = 24;
	const m = fmtDistance;
	/** « Point 3 déplacé, accroché au bord de la voie : gare ajustée aussi. » */
	const movedText = (n: number, snappedHere: boolean, also: string) =>
		t('shapePage.said.moved', {
			n,
			snapped: snappedHere ? 'yes' : 'no',
			hasAlso: also ? 'yes' : 'no',
			also
		});

	/** Avertissement non bloquant (lot 7d) : le quai ne longe plus une voie qu'il longeait. */
	let lostWarn = $state('');
	let saveAnyway = false;
	function commit(next: RingNode[], message: string) {
		history = [...history, $state.snapshot(pts) as RingNode[]];
		pts = next;
		errors = [];
		lostWarn = '';
		said = message;
		lastNote = '';
	}
	const snapped = (p: LonLat) => snapAt(p)?.point ?? p;

	function vertex(i: number) {
		errors = [];
		lastNote = '';
		if (selected === i) {
			selected = undefined;
			said = t('shapePage.said.deselected', { n: i + 1 });
			return;
		}
		selected = i;
		// La croix vient sur le point : la carte glisse, le zoom ne change pas.
		mapRef?.centerOn([pts[i].lon, pts[i].lat]);
		const o = orig.get(pts[i].id);
		said = locked[i]
			? t('shapePage.said.locked', { n: i + 1, links: linksOf(i) })
			: shared[i] && o
				? t('shapePage.said.selectedShared', { n: i + 1, info: pointInfo(o).move })
				: t('shapePage.said.selected', { n: i + 1 });
	}

	const pxFromCross = (p: { lon: number; lat: number }) => {
		const d = mapRef?.fromCross([p.lon, p.lat]);
		return d ? Math.hypot(d.x, d.y) : Infinity;
	};

	/** « Prendre ce point » : le sommet le plus proche de la croix (modifiable de préférence). */
	function pick() {
		errors = [];
		const near = pts
			.map((p, i) => ({ i, px: pxFromCross(p) }))
			.filter((c) => c.px <= PICK_PX)
			.sort((a, b) => Number(locked[a.i]) - Number(locked[b.i]) || a.px - b.px);
		if (near.length) return vertex(near[0].i);
		const a = anchorNodes
			.map((n, i) => ({ i, px: pxFromCross(n) }))
			.filter((c) => c.px <= PICK_PX)
			.sort((x, y) => x.px - y.px);
		if (a.length) return anchor(a[0].i);
		errors = [t('shapePage.error.noPoint')];
		said = errors[0];
	}

	/** « Ajouter un point ici » : sur le côté le plus proche de la croix, sous la croix. */
	function addHere() {
		errors = [];
		if (!preview || pts.length < 2) return;
		let best = -1,
			bestPx = Infinity;
		const sides = pts.length >= 3 ? pts.length : pts.length - 1;
		for (let i = 0; i < sides; i++) {
			const q = pts[(i + 1) % pts.length];
			const a = mapRef?.fromCross([pts[i].lon, pts[i].lat]);
			const b = mapRef?.fromCross([q.lon, q.lat]);
			if (!a || !b) continue;
			// Distance de la croix (0, 0) au segment AB, en pixels.
			const ab = { x: b.x - a.x, y: b.y - a.y };
			const l2 = ab.x ** 2 + ab.y ** 2 || 1;
			const u = Math.max(0, Math.min(1, -(a.x * ab.x + a.y * ab.y) / l2));
			const px = Math.hypot(a.x + u * ab.x, a.y + u * ab.y);
			if (px < bestPx) [best, bestPx] = [i, px];
		}
		if (best < 0 || bestPx > PICK_PX) {
			errors = [t('shapePage.error.noSide')];
			said = errors[0];
			return;
		}
		const next = [...pts];
		next.splice(best + 1, 0, { id: nextTempId(), lon: preview[0], lat: preview[1] });
		commit(
			next,
			t('shapePage.said.inserted', {
				n: best + 2,
				a: best + 1,
				b: ((best + 1) % pts.length) + 1,
				snapped: snap ? 'yes' : 'no'
			})
		);
		selected = best + 1;
	}
	function midpoint(i: number) {
		const a = pts[i],
			b = pts[(i + 1) % pts.length];
		const [lon, lat] = snapped([(a.lon + b.lon) / 2, (a.lat + b.lat) / 2]);
		const next = [...pts];
		next.splice(i + 1, 0, { id: nextTempId(), lon, lat });
		commit(
			next,
			t('shapePage.said.inserted', {
				n: i + 2,
				a: i + 1,
				b: ((i + 1) % pts.length) + 1,
				snapped: 'no'
			})
		);
		selected = i + 1;
		mapRef?.centerOn([lon, lat]);
	}
	function moveHere() {
		if (selected === undefined || !preview || selLocked) return;
		const i = selected;
		const next = [...pts];
		next[i] = { ...next[i], lon: preview[0], lat: preview[1] };
		const o = orig.get(next[i].id);
		const also = o && isLinked(o) ? followersPhrase(followers([o], [next[i]])) : '';
		commit(next, movedText(i + 1, !!snap, also));
		if (also) lastNote = movedText(i + 1, false, also);
		selected = undefined;
	}
	/** Sommet glissé au doigt puis relâché (lot 7d) : même accrochage, même historique. */
	function dragPoint(i: number, at: LonLat) {
		if (locked[i] || !pts[i]) return;
		errors = [];
		const s = snapAt(at);
		const [lon, lat] = s?.point ?? at;
		const next = [...pts];
		next[i] = { ...next[i], lon, lat };
		const o = orig.get(next[i].id);
		const also = o && isLinked(o) ? followersPhrase(followers([o], [next[i]])) : '';
		commit(next, movedText(i + 1, !!s, also));
		if (also) lastNote = movedText(i + 1, false, also);
		selected = undefined;
	}
	function removePoint() {
		if (selected === undefined || selLocked || selEdge || pts.length <= 3) return;
		const i = selected;
		const kept = shared[i] ? pointInfo(orig.get(pts[i].id)).remove : '';
		commit(
			pts.filter((_, k) => k !== i),
			t('shapePage.said.removed', { n: i + 1 }) + (kept ? ` ${kept}` : '')
		);
		if (kept) lastNote = `${t('shapePage.said.removed', { n: i + 1 })} ${kept}`;
		selected = undefined;
	}
	function addPoint() {
		if (!preview) return;
		commit(
			[...pts, { id: nextTempId(), lon: preview[0], lat: preview[1] }],
			t('drawPage.said.added', { n: pts.length + 1 })
		);
	}
	function anchor(i: number) {
		const n = anchorNodes[i];
		if (!n) return;
		commit(
			[...pts, { id: n.id, lon: n.lon, lat: n.lat }],
			t('shapePage.said.anchored', { n: pts.length + 1 })
		);
	}
	function undo() {
		lostWarn = '';
		const prev = history.at(-1);
		if (!prev) return;
		history = history.slice(0, -1);
		pts = prev;
		selected = undefined;
		errors = [];
		said = t('shapePage.said.undone');
	}

	async function finish() {
		if (!info || !ready) return;
		const unchanged =
			mode === 'reshape' &&
			pts.length === info.nodes.length &&
			pts.every((p, i) => p.id === info.nodes[i].id && samePlace(p, info.nodes[i]));
		if (unchanged && !previous) {
			errors = [t('shapePage.error.unchanged')];
			return;
		}
		const lockError = checkLocks(info.nodes, pts, mode);
		const all = [...(lockError ? [lockError] : []), ...(check.ok ? [] : check.errors)];
		if (all.length) {
			errors = all;
			said = all.join(' ');
			return;
		}
		// Voies longées par le quai d'origine et plus par la nouvelle forme (même règle que les
		// quêtes) : on le dit, sans bloquer (« Corriger » ou « Enregistrer quand même »).
		if (!saveAnyway) {
			const lines = railWays.map((w) => ({
				id: w.id,
				ref: w.tags?.['railway:track_ref'],
				coords: coords(w)
			}));
			const before = ringTracks(
				info.nodes.map((n) => [n.lon, n.lat] as LonLat),
				info.closed,
				lines
			);
			const lost = lostTracks(before, ring, lines);
			if (lost.length) {
				lostWarn = lostTracksMessage(lost);
				said = lostWarn;
				return;
			}
		}
		saveAnyway = false;
		saving = true;
		try {
			// Objets qui suivent les points partagés déplacés : dits dans le résumé (E8, E9).
			const also = followersPhrase(followers(info.nodes, pts));
			const summary = shapeSummary(name, mode, info.nodes.length, pts.length, also);
			await saveEdit({
				kind: 'shape',
				id: newEditId(),
				station: id,
				country: ready.station.country,
				createdAt: Date.now(),
				target: `way/${info.way.id}`,
				version: info.way.version,
				mode,
				before: info.nodes,
				nodes: $state.snapshot(pts) as RingNode[],
				name,
				shapeSummary: summary,
				summary
			});
			await goto(back);
		} catch {
			errors = [t('common.saveFailed')];
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head
	><title
		>{t('shapePage.title', { name: mode === 'area' ? t('map.toArea') : t('map.reshape') })}</title
	></svelte:head
>

<div class="screen" data-map-scope>
	<!-- data-center : centre visé, lu par les tests pour attendre la fin d'un déplacement. -->
	<!-- data-zoom : zoom de la carte, lu par les tests (vue reprise de E5, zoom conservé). -->
	<div
		class="mapbox"
		data-center={centerNow?.map((v) => v.toFixed(7)).join(',')}
		data-zoom={zoomNow?.toFixed(2)}
	>
		{#if view && ready && info && isQuai && !info.refused}
			<DrawMap
				bind:this={mapRef}
				imagery={imageryOf(ready.station.country)}
				center={[ready.station.lon, ready.station.lat]}
				{bounds}
				view={startView}
				tracks={trackLines}
				platforms={platformRings}
				{tracksUnder}
				{platformsUnder}
				points={ring}
				{selected}
				{preview}
				snapped={!!snap}
				closed
				{locked}
				{shared}
				{vertexLabel}
				midpoints={mode === 'reshape' || pts.length >= 3}
				{guide}
				{anchors}
				onmove={(c, z) => {
					centerNow = c;
					zoomNow = z;
				}}
				onvertex={vertex}
				onmidpoint={midpoint}
				onanchor={anchor}
				ondragpoint={dragPoint}
			/>
		{/if}
	</div>

	{#if !ready || !pending.loaded}
		<p class="status float" role="status">{t('common.loading')}</p>
	{:else if !info || !isQuai}
		<div class="status float" role="alert">
			<p>{t('shapePage.notFound')}</p>
			<a class="btn-quiet" href={back}>{t('shapePage.backToMap')}</a>
		</div>
	{:else if info.refused}
		<div class="status float" role="alert">
			<p>{info.refused}</p>
			<a class="btn-quiet" href={`${srv().web}/${osm}`} rel="external"
				>{t('common.seeOnOsm')}<Icon name="ext" size={16} /></a
			>
			<a class="btn-quiet" href={back}>{t('shapePage.backToMap')}</a>
		</div>
	{/if}

	<div class="stack">
		<header class="top float" data-map-avoid>
			<div class="row">
				<a class="icon-btn" href={back} aria-label={t('shapePage.quit')}
					><Icon name="close" size={22} /></a
				>
				<h1>{mode === 'area' ? t('map.toArea') : t('map.reshape')}</h1>
				<span class="count">{t('drawPage.points', { count: pts.length })}</span>
			</div>
			{#if info && !info.refused}
				<p>
					<strong>{name}</strong> ·
					{#if sel && selLocked}
						<Rich
							text={t('shapePage.help.locked', { n: selected! + 1, links: linksOf(selected!) })}
						/>
					{:else if sel}
						<Rich text={t('shapePage.help.move', { n: selected! + 1 })} />
					{:else if mode === 'area'}
						{t('shapePage.help.area')}
						{#if anchorNodes.length}{t('shapePage.help.anchors')}{/if}
					{:else}
						{t('shapePage.help.reshape')}
						{#if info.nodes.some(isLinked)}{t('shapePage.help.shared')}{/if}
					{/if}
				</p>
				{#if sel && (selInfo.move || selInfo.remove)}
					<!-- Ce qui suivra : dit avant de valider, sans bloquer. -->
					<p class="share" role="note">
						<Icon name="info" size={16} /><span>{selInfo.move} {selInfo.remove}</span>
					</p>
				{:else if !sel && lastNote}
					<p class="share" role="note">
						<Icon name="info" size={16} /><span>{lastNote}</span>
					</p>
				{/if}
				{#if notice}
					<div class="notice" role="note">
						<Icon name="info" size={16} /><span>{notice}</span>
						<button class="btn-quiet" type="button" onclick={() => (noticeClosed = true)}
							>{t('shapePage.understood')}</button
						>
					</div>
				{/if}
			{/if}
		</header>
		{#if view && info && !info.refused}
			<div class="tools" data-map-avoid>
				<div class="zoom float">
					<button type="button" aria-label={t('common.zoomIn')} onclick={() => mapRef?.zoom(1)}
						><Icon name="plus" size={20} /></button
					>
					<button type="button" aria-label={t('common.zoomOut')} onclick={() => mapRef?.zoom(-1)}
						><Icon name="minus" size={20} /></button
					>
				</div>
				<NudgePad onnudge={(dx, dy) => mapRef?.nudge(dx, dy)} />
			</div>
		{/if}
	</div>

	{#if view && info && isQuai && !info.refused}
		<section class="panel float" aria-label={t('edit.label.shape')} data-map-avoid>
			<div class="inforow">
				<div class="info" class:ok={!!snap} role="status">
					<Icon name={snap ? 'check' : 'locate'} size={20} />
					<span>
						{#if snap}<Rich text={t('shapePage.snapped', { offset: fmtDecimal(1.5) })} />{:else}{t(
								'drawPage.underCross'
							)}{/if}
						{#if pts.length >= 2}
							· {t('drawPage.length', { length: m(check.lengthM) })}{/if}
					</span>
				</div>
				<label class="snapopt">
					<input
						type="checkbox"
						role="switch"
						checked={snapPref.on}
						onchange={(e) => setSnapPref(e.currentTarget.checked)}
					/>{t('drawPage.snapOption')}
				</label>
			</div>
			<p class="visually-hidden" aria-live="polite">{said}</p>
			{#if errors.length}
				<ul class="errors banner err" role="alert">
					{#each errors as e (e)}<li>{e}</li>{/each}
				</ul>
			{/if}
			{#if lostWarn}
				<div class="lost banner warn" role="alert">
					<p><Icon name="alert" size={18} /><span>{lostWarn}</span></p>
					<div class="two">
						<button class="btn-sm" type="button" onclick={() => (lostWarn = '')}
							>{t('input.fix')}</button
						>
						<button
							class="btn-sm"
							type="button"
							disabled={saving}
							onclick={() => {
								saveAnyway = true;
								lostWarn = '';
								finish();
							}}>{t('drawPage.saveAnyway')}</button
						>
					</div>
				</div>
			{/if}

			{#if !sel}
				<div class="cross">
					<button
						class="btn-sm"
						type="button"
						disabled={!pts.length && !anchorNodes.length}
						onclick={pick}><Icon name="locate" size={18} />{t('shapePage.pick')}</button
					>
					{#if mode === 'reshape' || pts.length >= 3}
						<button class="btn-sm" type="button" disabled={!preview} onclick={addHere}
							><Icon name="plus" size={18} />{t('shapePage.addHere')}</button
						>
					{/if}
				</div>
			{/if}
			<div class="two">
				{#if sel}
					<button
						class="btn btn-secondary"
						type="button"
						disabled={selLocked || selEdge || pts.length <= 3}
						onclick={removePoint}><Icon name="trash" size={20} />{t('shapePage.remove')}</button
					>
					<button class="btn" type="button" disabled={selLocked || !preview} onclick={moveHere}
						>{t('shapePage.moveHere')}</button
					>
				{:else}
					<button
						class="btn btn-secondary"
						type="button"
						disabled={!history.length}
						aria-label={t('shapePage.undoLabel')}
						onclick={undo}><Icon name="undo" size={20} />{t('common.cancel')}</button
					>
					{#if mode === 'area'}
						<button class="btn" type="button" disabled={!preview} onclick={addPoint}
							>{t('drawPage.addPoint')}</button
						>
					{:else}
						<button class="btn" type="button" disabled={saving} onclick={finish}
							>{t('shapePage.finish')}</button
						>
					{/if}
				{/if}
			</div>
			{#if sel || mode === 'area'}
				<div class="foot">
					{#if sel}
						<button
							class="btn-quiet"
							type="button"
							disabled={!history.length}
							aria-label={t('shapePage.undoLabel')}
							onclick={undo}><Icon name="undo" size={18} />{t('common.cancel')}</button
						>
					{/if}
					<button
						class="btn-quiet"
						type="button"
						disabled={saving || pts.length < 3}
						onclick={finish}>{t('shapePage.finish')}</button
					>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.screen {
		position: relative;
		height: calc(100dvh - var(--band));
		overflow: hidden;
		background: #8c877c;
	}
	.mapbox {
		position: absolute;
		inset: 0;
	}
	.status {
		position: absolute;
		inset: 45% 16px auto;
		margin: 0;
		padding: 12px;
		text-align: center;
	}
	.status p {
		margin: 0 0 4px;
	}
	.stack {
		position: absolute;
		top: calc(8px + env(safe-area-inset-top));
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		display: flex;
		flex-direction: column;
		gap: 8px;
		pointer-events: none;
	}
	.stack > * {
		pointer-events: auto;
	}
	.top {
		padding: 2px 12px 8px 2px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	h1 {
		flex-grow: 1;
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.4;
	}
	.count {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.top p {
		margin: 0 0 0 12px;
		font-size: 0.875rem;
		line-height: 1.43;
		color: var(--text-2);
	}
	.top p :global(strong) {
		color: var(--text);
	}
	.tools {
		align-self: flex-end;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
	}
	.zoom {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.zoom button {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
	.zoom button + button {
		border-top: 1px solid var(--overlay-line);
	}
	.panel {
		position: absolute;
		left: calc(8px + env(safe-area-inset-left));
		right: calc(8px + env(safe-area-inset-right));
		bottom: calc(24px + env(safe-area-inset-bottom)); /* au-dessus de l'attribution */
		max-width: 560px;
		margin: 0 auto;
		padding: 8px 8px 2px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.inforow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0 8px;
	}
	.snapopt {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 6px;
		font-size: 0.875rem;
		color: var(--text-2);
		cursor: pointer;
	}
	.snapopt input {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--primary);
	}
	.info {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		font-size: 0.9375rem;
		color: var(--text-2);
	}
	.info span {
		color: var(--text);
	}
	.info.ok {
		color: var(--ok);
	}
	.errors {
		display: block;
		padding-left: 2em;
	}
	.lost {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lost p {
		display: flex;
		gap: 6px;
		margin: 0;
	}
	.lost :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.two .btn {
		padding: 0 10px;
	}
	.cross {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.cross .btn-sm {
		flex: 1 1 140px;
		padding: 0 8px;
	}
	.top p.share {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin-top: 6px;
		color: var(--text);
	}
	.share :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--text-2);
	}
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 6px 0 0 12px;
		font-size: 0.875rem;
		line-height: 1.43;
		color: var(--text);
	}
	.notice :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--text-2);
	}
	.notice .btn-quiet {
		flex-shrink: 0;
		min-height: 32px;
		margin-top: -6px;
	}
	.foot {
		display: flex;
		justify-content: center;
		gap: 8px;
	}
</style>
