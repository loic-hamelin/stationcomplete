// Lot 4 — File d'envoi qui part toute seule au retour du réseau, et état du réseau.
// Module léger, chargé au démarrage (bandeau réseau) : il n'importe ni l'index des gares ni
// le moteur de quêtes ; le module d'envoi est chargé à la demande.

import { readPref, writePref } from './cache.js';
import { server } from './osmserver.svelte.js';
import type { SendResult } from './send.svelte.js';

// ---------------- File d'envoi ----------------
// L'utilisateur a relu et validé l'envoi d'une gare sans réseau : on l'envoie au retour du réseau.

interface Queued {
	station: string;
	name: string;
	comment: string;
	/** « Je souhaite une relecture » choisi sur E8 (absent : choix par défaut à l'envoi). */
	review?: boolean;
	at: number;
}
const queueKey = () => `queue:${server.id}`;
export const queue = $state<{ list: Queued[]; last?: SendResult & { name: string } }>({
	list: readPref<Queued[]>(queueKey(), [])
});
const saveQueue = () => writePref(queueKey(), $state.snapshot(queue.list));
export const isQueued = (id: string) => queue.list.some((q) => q.station === id);

export function enqueue(station: string, name: string, comment: string, review?: boolean) {
	queue.list = [
		...queue.list.filter((q) => q.station !== station),
		{ station, name, comment, review, at: Date.now() }
	];
	saveQueue();
}
export function dequeue(station: string) {
	queue.list = queue.list.filter((q) => q.station !== station);
	saveQueue();
}

let flushing = false;
/** Envoie les gares en attente, une à une. Appelé au démarrage et au retour du réseau. */
export async function flushQueue() {
	if (flushing || !navigator.onLine || !queue.list.length) return;
	flushing = true;
	try {
		// Module d'envoi chargé à la demande : il ne pèse pas sur le démarrage de l'appli.
		// (Précaché par le service worker : disponible aussi après un démarrage hors-ligne.)
		const mod = await import('./send.svelte.js').catch(() => undefined);
		if (!mod) return;
		const { sendStation } = mod;
		for (const q of [...queue.list]) {
			const r = await sendStation(q.station, q.name, q.comment, q.review);
			// Erreur temporaire (réseau, limite) : la gare reste en file pour le prochain retour.
			// (Saisies retenues par les contrôles avant envoi : pas temporaire, la gare sort de la file.)
			if (r.error && !r.changeset && !r.held) {
				queue.last = { ...r, name: q.name };
				break;
			}
			dequeue(q.station);
			queue.last = { ...r, name: q.name };
		}
	} finally {
		flushing = false;
	}
}

export const net = $state({ online: true });
let listening = false;
/** À appeler une fois (layout) : suit l'état du réseau et vide la file quand il revient. */
export function watchNetwork() {
	net.online = navigator.onLine;
	if (listening) return;
	listening = true;
	addEventListener('online', () => {
		net.online = true;
		flushQueue();
	});
	addEventListener('offline', () => (net.online = false));
	flushQueue();
}
