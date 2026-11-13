// Envoi des saisies d'une gare vers OpenStreetMap : un changeset par gare (lot 3).
//
// Résilience (architecture § 4.6, relecture) :
// - chaque étape est notée sur le téléphone AVANT l'appel réseau ;
// - si l'envoi a été coupé, on vérifie d'abord sur le serveur si le changeset contient déjà
//   des modifications (un seul envoi par changeset) : jamais de doublon ;
// - un envoi coupé peut encore aboutir côté serveur : on attend 5 minutes avant de réessayer.

import { readPref, writePref } from './cache.js';
import { recordCountry } from './core/countries.js';
import { isRemoval, type Edit } from './core/edits.js';
import type { OsmElement } from './core/osm.js';
import {
	changesetTags,
	changesetXml,
	conflictTarget,
	deletedWays,
	elementsToFetch,
	osmChangeXml,
	planUpload,
	proposedComment,
	signsToCheck,
	pointsToCheck,
	usageToCheck
} from './core/upload.js';
import { uploadBlock } from './core/remote.js';
import { heldBack, suggestReview, validateEdits, type Issue } from './core/validate.js';
import { stationCacheKey } from './core/storage.js';
import { getCachedStation } from './cache.js';
import { findStation } from './stations.js';
import { account, osmFetch } from './auth.svelte.js';
import { refreshConfig } from './remote.svelte.js';
import { editsOf, removeEdits, updateEdits } from './edits.svelte.js';
import { server, srv } from './osmserver.svelte.js';
import { t } from './i18n/t.js';

export const APP_VERSION = '0.4';
export const demoRefused = () => t('send.demoRefused');
const RETRY_AFTER_CUT_MS = 5 * 60 * 1000;

interface Job {
	changeset: number;
	editIds: string[];
	at: number;
}
const jobKey = (station: string) => `upload:${server.id}:${station}`;
const getJob = (station: string) => readPref<Job | undefined>(jobKey(station), undefined);
const setJob = (station: string, job?: Job) => writePref(jobKey(station), job);

export type Progress = 'idle' | 'checking' | 'reading' | 'opening' | 'uploading' | 'closing';
export const sending = $state<{ station?: string; step: Progress }>({ step: 'idle' });

export interface SendResult {
	changeset?: number;
	sent: number;
	conflicts: number;
	/** Saisies retenues par les contrôles avant envoi (erreur, ou avertissement non vérifié). */
	held?: number;
	/** Message à afficher si l'envoi n'a pas pu se faire maintenant. */
	error?: string;
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string
	) {
		super(`HTTP ${status}`);
	}
}

async function call(path: string, init: { method?: string; body?: string; xml?: boolean } = {}) {
	const r = await osmFetch(path, init);
	const body = await r.text();
	if (!r.ok) throw new HttpError(r.status, body);
	return { body, retryAfter: r.headers.get('Retry-After') };
}

/** Lance les tâches deux par deux au plus (sobriété envers le serveur OSM). */
async function pool<T>(tasks: (() => Promise<T>)[], size = 2): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < tasks.length; i += size)
		out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
	return out;
}

const elementsOf = (body: string) => JSON.parse(body).elements as OsmElement[];

async function readFresh(edits: Edit[]): Promise<OsmElement[]> {
	const ids = elementsToFetch(edits);
	const out: OsmElement[] = [];
	for (const [type, list] of [
		['nodes', ids.nodes],
		['ways', ids.ways],
		['relations', ids.relations]
	] as const) {
		for (let i = 0; i < list.length; i += 200) {
			const chunk = list.slice(i, i + 200);
			try {
				const { body } = await call(`/api/0.6/${type}.json?${type}=${chunk.join(',')}`);
				out.push(...elementsOf(body));
			} catch (e) {
				// 404/410 : un objet a été supprimé ; on relit un par un pour isoler les autres.
				if (!(e instanceof HttpError) || ![404, 410].includes(e.status)) throw e;
				for (const id of chunk) {
					try {
						const one = await call(`/api/0.6/${type.slice(0, -1)}/${id}.json`);
						out.push(...elementsOf(one.body));
					} catch (err) {
						if (!(err instanceof HttpError) || ![404, 410].includes(err.status)) throw err;
					}
				}
			}
		}
	}
	// Quais modifiés en forme ou supprimés (lot 7) : usage à jour de chacun de leurs nœuds.
	// Une lecture /map de la petite emprise du quai suffit (elle renvoie tous les ways et
	// relations de ses nœuds) ; si elle est refusée (emprise trop chargée), on relit nœud par
	// nœud ses ways et ses relations, deux appels à la fois au plus.
	for (const u of usageToCheck(edits)) {
		try {
			const { body } = await call(
				`/api/0.6/map.json?bbox=${u.bbox.map((x) => x.toFixed(7)).join(',')}`
			);
			out.push(...elementsOf(body));
		} catch (e) {
			if (!(e instanceof HttpError) || ![400, 509].includes(e.status)) throw e;
			for (let i = 0; i < u.nodes.length; i += 200)
				try {
					const { body } = await call(
						`/api/0.6/nodes.json?nodes=${u.nodes.slice(i, i + 200).join(',')}`
					);
					out.push(...elementsOf(body));
				} catch (err) {
					// Un nœud supprimé entre-temps : il manquera, la saisie passera « à revoir ».
					if (!(err instanceof HttpError) || ![404, 410].includes(err.status)) throw err;
				}
			const lists = await pool(
				u.nodes.flatMap((n) =>
					['ways', 'relations'].map(
						(what) => async () => elementsOf((await call(`/api/0.6/node/${n}/${what}.json`)).body)
					)
				)
			);
			out.push(...lists.flat());
		}
	}
	// Relations des quais supprimés : relues explicitement (on les modifiera).
	const rels = await pool(
		deletedWays(edits).map(
			(w) => async () => elementsOf((await call(`/api/0.6/way/${w}/relations.json`)).body)
		)
	);
	out.push(...rels.flat());
	// Pancartes à supprimer (lot 7d) : voie complète (versions, alignement des voisins), puis
	// tous les ways et relations du nœud. Un objet disparu (404/410) manque : « à revoir ».
	const gone = async (path: string) => {
		try {
			return elementsOf((await call(path)).body);
		} catch (e) {
			if (!(e instanceof HttpError) || ![404, 410].includes(e.status)) throw e;
			return [];
		}
	};
	const signs = await pool(
		signsToCheck(edits).flatMap((s) => [
			...(s.way !== undefined ? [() => gone(`/api/0.6/way/${s.way}/full.json`)] : []),
			() => gone(`/api/0.6/node/${s.node}/ways.json`),
			() => gone(`/api/0.6/node/${s.node}/relations.json`)
		])
	);
	out.push(...signs.flat());
	// Équipements ponctuels à supprimer (lot Équipements) : ways et relations du nœud.
	const points = await pool(
		pointsToCheck(edits).flatMap((n) => [
			() => gone(`/api/0.6/node/${n}/ways.json`),
			() => gone(`/api/0.6/node/${n}/relations.json`)
		])
	);
	out.push(...points.flat());
	return out;
}

async function closeChangeset(id: number) {
	try {
		await call(`/api/0.6/changeset/${id}/close`, { method: 'PUT' });
	} catch {
		/* déjà fermé, ou fermeture automatique par le serveur au bout d'une heure */
	}
}

/** Termine un envoi interrompu, s'il y en a un. Renvoie true si la gare est libre. */
async function resume(station: string): Promise<SendResult | undefined> {
	const job = getJob(station);
	if (!job) return undefined;
	sending.step = 'checking';
	const { body } = await call(`/api/0.6/changeset/${job.changeset}.json`);
	const cs = JSON.parse(body).changeset ?? JSON.parse(body).elements?.[0];
	const changes = Number(cs?.changes_count ?? 0);
	if (changes > 0) {
		// L'envoi précédent a bien abouti : on range les saisies qu'il contenait.
		await removeEdits(job.editIds);
		await closeChangeset(job.changeset);
		setJob(station, undefined);
		return { changeset: job.changeset, sent: job.editIds.length, conflicts: 0 };
	}
	if (cs?.open && Date.now() - job.at < RETRY_AFTER_CUT_MS) {
		const min = Math.ceil((RETRY_AFTER_CUT_MS - (Date.now() - job.at)) / 60000);
		return {
			sent: 0,
			conflicts: 0,
			error: t('send.interrupted', { min })
		};
	}
	await closeChangeset(job.changeset);
	setJob(station, undefined);
	return undefined;
}

/**
 * Contrôles avant envoi (QA-2) sur la vue locale de la gare : données en cache + saisies en
 * attente. Sans données en cache (cas improbable : la saisie s'est faite sur ces données),
 * aucun contrôle local : la relecture du serveur (planUpload) reste le garde-fou.
 */
export async function checkBeforeSend(station: string, edits: Edit[]): Promise<Issue[]> {
	const cached = await getCachedStation(stationCacheKey(server.id, station));
	const st = await findStation(station).catch(() => undefined);
	if (!cached || !st) return [];
	return validateEdits(cached.elements, editsOf(station), edits, st.bbox, st.country);
}

export async function sendStation(
	station: string,
	stationName: string,
	comment: string,
	/** « Je souhaite une relecture » ; absent (file d'envoi plus ancienne) : choix par défaut. */
	review?: boolean
): Promise<SendResult> {
	if (!srv().canUpload) return { sent: 0, conflicts: 0, error: t('send.unavailable') };
	if (!navigator.onLine) return { sent: 0, conflicts: 0, error: t('send.offline') };
	if (sending.step !== 'idle') return { sent: 0, conflicts: 0, error: t('send.busy') };
	// Arrêt d'urgence : /config.json est relu juste avant chaque envoi.
	const blocked = uploadBlock(
		await refreshConfig(),
		APP_VERSION,
		server.id === 'prod',
		account.user?.name
	);
	if (blocked) return { sent: 0, conflicts: 0, error: blocked };
	if (server.id === 'prod' && editsOf(station).some((e) => e.demo && !e.conflict))
		return { sent: 0, conflicts: 0, error: demoRefused() };
	sending.station = station;
	try {
		const resumed = await resume(station);
		if (resumed) return resumed;

		const candidates = editsOf(station).filter((e) => !e.conflict);
		if (!candidates.length) return { sent: 0, conflicts: 0 };
		// Contrôles avant envoi : une saisie fautive (ou « à vérifier » non vérifiée) reste ici.
		const issues = await checkBeforeSend(station, candidates);
		const held = heldBack(candidates, issues);
		const edits = candidates.filter((e) => !held.has(e.id));
		if (!edits.length) return { sent: 0, conflicts: 0, held: held.size, error: t('validate.held') };

		sending.step = 'reading';
		const plan = planUpload(edits, await readFresh(edits));
		if (plan.conflicts.length)
			await updateEdits(
				plan.conflicts.map((c) => ({ ...edits.find((e) => e.id === c.id)!, conflict: c.reason }))
			);
		if (!plan.sent.length)
			return { sent: 0, conflicts: plan.conflicts.length, held: held.size || undefined };

		const sentEdits = edits.filter((e) => plan.sent.includes(e.id));
		// Relevé sur place : numéros, pancartes, et « n'existe plus ». Image : dessin et formes.
		const read = (t?: Record<string, unknown>) =>
			!!t && !Object.keys(t).every((k) => k === 'check_date');
		const tags = changesetTags({
			comment: comment || proposedComment(stationName, sentEdits),
			version: APP_VERSION,
			// Pays de la gare, noté dans chaque saisie (France pour les saisies d'avant le lot P1).
			country: recordCountry(sentEdits[0]),
			survey: sentEdits.some(
				(e) =>
					e.kind === 'node' ||
					e.kind === 'point' ||
					(e.kind === 'tags' && read(e.tags)) ||
					(e.kind === 'shape' && read(e.tags)) ||
					(isRemoval(e) && e.reason === 'gone')
			),
			// Photo aérienne : dessin, formes, placements sur la photo (un équipement situé sur
			// un quai ne s'en sert pas), suppressions à distance.
			imagery: sentEdits.some(
				(e) =>
					e.kind !== 'tags' &&
					!(e.kind === 'point' && e.placed === 'platform') &&
					!(isRemoval(e) && e.reason === 'gone')
			),
			// Demande de relecture (QA-3) : choix de l'utilisateur sur E8, sinon choix par défaut.
			review: review ?? suggestReview(sentEdits, issues)
		});

		sending.step = 'opening';
		const changeset = Number(
			(
				await call('/api/0.6/changeset/create', {
					method: 'PUT',
					body: changesetXml(tags),
					xml: true
				})
			).body
		);
		// Noté avant l'envoi : en cas de coupure, on saura où vérifier.
		setJob(station, { changeset, editIds: plan.sent, at: Date.now() });

		sending.step = 'uploading';
		try {
			await call(`/api/0.6/changeset/${changeset}/upload`, {
				method: 'POST',
				body: osmChangeXml(changeset, plan),
				xml: true
			});
		} catch (e) {
			if (e instanceof HttpError && [409, 412].includes(e.status)) {
				// Conflit sur un objet précis : il passe « à revoir », les autres restent prêts.
				// (412 : un objet à supprimer est encore utilisé, ou un objet référencé a disparu.)
				const target = conflictTarget(e.body);
				const matched = sentEdits.filter((ed) => target && plan.touched[ed.id]?.includes(target));
				const hit = matched.length ? matched : sentEdits;
				await updateEdits(
					hit.map((ed) => ({
						...ed,
						conflict: e.status === 412 ? t('send.conflict412') : t('send.conflict409')
					}))
				);
				await closeChangeset(changeset);
				setJob(station, undefined);
				return { sent: 0, conflicts: plan.conflicts.length + hit.length };
			}
			throw e;
		}
		await removeEdits(plan.sent);
		sending.step = 'closing';
		await closeChangeset(changeset);
		setJob(station, undefined);
		return {
			changeset,
			sent: plan.sent.length,
			conflicts: plan.conflicts.length,
			held: held.size || undefined
		};
	} catch (e) {
		if (e instanceof HttpError) {
			if (e.status === 429 || e.status === 509)
				return {
					sent: 0,
					conflicts: 0,
					error: t('send.rateLimit')
				};
			if (e.status === 401 || e.status === 403)
				return { sent: 0, conflicts: 0, error: t('send.expired') };
			return { sent: 0, conflicts: 0, error: t('send.refused', { status: e.status }) };
		}
		return {
			sent: 0,
			conflicts: 0,
			error: t('send.lost')
		};
	} finally {
		sending.step = 'idle';
		sending.station = undefined;
	}
}
