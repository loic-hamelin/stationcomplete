// Escaliers et escaliers mécaniques EXISTANTS (lot « Équipements », étape 3) : compléter, jamais
// dessiner. Code pur, chargeable par Node (imports en .ts). Tags et sources :
// docs/osm-tags-rapport.md § 10.3.
//
// - Escalier : highway=steps (de facto). incline=up/down : le chemin monte (up) ou descend
//   (down) DANS LE SENS DE TRACÉ du way. handrail=yes/no, handrail:left/right (gauche et droite
//   en suivant le sens du way). tactile_paving=yes/no. step_count facultatif.
// - Escalier mécanique : highway=steps + conveying=forward/backward/reversible (accepté) :
//   forward = il avance dans le sens du way. Tapis roulant : highway=footway + conveying.
// - On ne retourne jamais un way : les réponses sont relatives à son sens, montré par une flèche.

import type { Tags } from './osm.ts';

export type WayKind = 'stairs' | 'escalator' | 'walkway';

/** Escalier, escalier mécanique ou tapis roulant (sinon undefined). */
export function wayKindOf(t: Tags = {}): WayKind | undefined {
	const moving = !!t.conveying && t.conveying !== 'no';
	if (t.highway === 'steps') return moving ? 'escalator' : 'stairs';
	if (t.highway === 'footway' && moving) return 'walkway';
	return undefined;
}

export type StepsItem = 'incline' | 'conveying' | 'handrail' | 'tactile';

/** Questions de chaque type (dans l'ordre de la fiche). step_count reste facultatif. */
export const ITEMS_OF: Record<WayKind, StepsItem[]> = {
	stairs: ['incline', 'handrail', 'tactile'],
	escalator: ['conveying', 'incline'],
	walkway: ['conveying']
};

/** Valeur connue d'une question (undefined : à relever). */
export function stepsValue(item: StepsItem, t: Tags = {}): string | undefined {
	if (item === 'incline') {
		const v = t.incline;
		if (v === 'up' || v === 'down') return v;
		// Pente chiffrée (« 30 % », « -20° ») : le sens est connu par son signe.
		return v && /^-?\d/.test(v) ? (v.startsWith('-') ? 'down' : 'up') : undefined;
	}
	if (item === 'conveying') {
		const v = t.conveying;
		return v === 'forward' || v === 'backward' || v === 'reversible' ? v : undefined;
	}
	if (item === 'handrail') {
		const l = t['handrail:left'],
			r = t['handrail:right'];
		if (l === 'yes' && r === 'yes') return 'both';
		if (l === 'yes' && r !== 'yes') return r === 'no' ? 'left' : 'yes';
		if (r === 'yes') return l === 'no' ? 'right' : 'yes';
		if (t.handrail === 'yes' || t.handrail === 'no') return t.handrail;
		if (t['handrail:center'] === 'yes') return 'yes';
		return undefined;
	}
	const v = t.tactile_paving;
	return v ? v : undefined;
}

/** Questions encore sans réponse pour ce chemin. */
export const stepsMissing = (kind: WayKind, t: Tags = {}) =>
	ITEMS_OF[kind].filter((i) => stepsValue(i, t) === undefined);

/** Réponses de la fiche (undefined = « Je ne sais pas » : rien d'écrit). */
export interface StepsInput {
	incline?: 'up' | 'down';
	conveying?: 'forward' | 'backward' | 'reversible';
	/** Mains courantes, gauche et droite en suivant la flèche (sens du way). */
	handrail?: 'both' | 'left' | 'right' | 'no';
	tactile?: 'yes' | 'no';
	/** Nombre de marches, tel que saisi (facultatif). */
	stepCount?: string;
}

/** Nombre de marches plausible (1 à 500) ; undefined si vide ; NaN si illisible. */
export function parseStepCount(v?: string): number | undefined {
	const s = (v ?? '').trim();
	if (!s) return undefined;
	const n = Number(s);
	return Number.isInteger(n) && n >= 1 && n <= 500 ? n : NaN;
}

/**
 * Tags à écrire d'après les réponses : seulement ce qui change. Les mains courantes s'écrivent
 * avec handrail=yes/no et, si le côté est connu, handrail:left / handrail:right.
 */
export function stepsTags(kind: WayKind, input: StepsInput, current: Tags = {}) {
	const want: Record<string, string> = {};
	const items = ITEMS_OF[kind];
	if (items.includes('incline') && input.incline) want.incline = input.incline;
	if (items.includes('conveying') && input.conveying) want.conveying = input.conveying;
	if (items.includes('handrail') && input.handrail) {
		const h = input.handrail;
		want.handrail = h === 'no' ? 'no' : 'yes';
		if (h === 'both') Object.assign(want, { 'handrail:left': 'yes', 'handrail:right': 'yes' });
		if (h === 'left') Object.assign(want, { 'handrail:left': 'yes', 'handrail:right': 'no' });
		if (h === 'right') Object.assign(want, { 'handrail:left': 'no', 'handrail:right': 'yes' });
		if (h === 'no') {
			// Aucune main courante : les côtés éventuellement notés « yes » sont contredits.
			for (const k of ['handrail:left', 'handrail:right', 'handrail:center'])
				if (current[k] === 'yes') want[k] = 'no';
		}
	}
	if (items.includes('tactile') && input.tactile) want.tactile_paving = input.tactile;
	const n = parseStepCount(input.stepCount);
	if (kind === 'stairs' && n !== undefined && !Number.isNaN(n)) want.step_count = String(n);
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(want)) if (current[k] !== v) out[k] = v;
	return out;
}

/**
 * Sens de la flèche à dessiner sur la carte, par rapport au sens du way : vers le haut pour un
 * escalier (incline), dans le sens de marche pour un escalier mécanique ou un tapis roulant.
 * undefined : sens inconnu (ou réversible), pas de flèche.
 */
export function arrowOf(kind: WayKind, t: Tags = {}): 'forward' | 'backward' | undefined {
	if (kind !== 'stairs') {
		const c = stepsValue('conveying', t);
		if (c === 'forward' || c === 'backward') return c;
		if (kind === 'walkway') return undefined;
	}
	const i = stepsValue('incline', t);
	return i === 'up' ? 'forward' : i === 'down' ? 'backward' : undefined;
}
