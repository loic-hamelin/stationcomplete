// Équipements utiles aux voyageurs (lot « Équipements ») : caractéristiques des quais.
// Code pur. Tags choisis et sources : docs/osm-tags-rapport.md § 10.
//
// Règles OSM rappelées :
// - OSM ne garde que le durable : aucun état de panne n'est écrit (écran éteint, ascenseur en
//   panne…) ; « Oui » veut dire « l'équipement existe ».
// - « Je ne sais pas » ne change jamais rien (aucun tag écrit, aucun tag retiré).
// - Tout se relève sur place (règle canSurvey) : rien de ce lot ne se voit sans ambiguïté sur la
//   photo aérienne (un abri se confond avec un auvent, un local, un éclairage ; photo ancienne).

import type { Tags } from './osm.ts';

/** Caractéristiques d'un quai demandées dans la fiche E7, dans l'ordre d'affichage. */
export const PLATFORM_ITEMS = ['height', 'display', 'shelter', 'tactile', 'bench'] as const;
export type PlatformItem = (typeof PLATFORM_ITEMS)[number];

/** Clé OSM écrite pour chaque caractéristique. */
export const ITEM_KEY: Record<PlatformItem, string> = {
	// Hauteur du quai au-dessus du rail, en mètres (wiki : Tag:railway=platform_edge).
	height: 'height',
	// Écrans d'affichage des trains : clé de facto la plus utilisée pour un affichage dynamique
	// (wiki : Key:passenger_information_display) ; departures_board=* présent vaut réponse.
	display: 'passenger_information_display',
	shelter: 'shelter',
	tactile: 'tactile_paving',
	bench: 'bench'
};

export type YesNo = 'yes' | 'no';

/**
 * Réponses de la fiche : une valeur, ou rien (« Je ne sais pas » : aucun changement).
 * `height` est la saisie telle quelle (« 0,55 », « 0.76 », « 92 cm »…).
 */
export type PlatformEquipmentInput = {
	height?: string;
	display?: YesNo;
	shelter?: YesNo;
	tactile?: YesNo;
	bench?: YesNo;
};

/** Hauteur lue (« 0,55 », « 0.55 m », « 55 cm », « 55 ») en mètres ; undefined si illisible. */
export function parseHeight(v: string | undefined): number | undefined {
	const s = (v ?? '').trim().toLowerCase().replace(',', '.');
	const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|cm)?$/);
	if (!m) return undefined;
	let n = Number(m[1]);
	// Sans unité, un nombre de 10 à 200 est lu en centimètres (« 55 » → 0,55 m).
	if (m[2] === 'cm' || (!m[2] && n >= 10)) n = n / 100;
	return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : undefined;
}

/** Hauteur plausible d'un quai voyageurs (m) : de 0,10 à 1,50 m au-dessus du rail. */
export const HEIGHT_RANGE = { min: 0.1, max: 1.5 } as const;

/** Valeur OSM d'une hauteur : mètres, point décimal, sans zéro inutile (0.55, 0.9, 1). */
export const formatHeight = (m: number) => String(Math.round(m * 100) / 100);

/** La saisie de hauteur est-elle valable ? (vide = « Je ne sais pas » : valable) */
export function heightProblem(v: string | undefined): 'format' | 'range' | undefined {
	if (!v || !v.trim()) return undefined;
	const n = parseHeight(v);
	if (n === undefined) return 'format';
	if (n < HEIGHT_RANGE.min || n > HEIGHT_RANGE.max) return 'range';
	return undefined;
}

/** Valeurs de departures_board qui désignent un affichage dynamique (écran). */
const DYNAMIC_BOARDS = ['realtime', 'delay'];

/** Valeur actuelle d'une caractéristique d'après les tags d'un objet (undefined : inconnue). */
export function itemValue(item: PlatformItem, t: Tags = {}): string | undefined {
	if (item === 'height') {
		const n = parseHeight(t.height);
		return n === undefined ? undefined : formatHeight(n);
	}
	if (item === 'display') {
		const v = t.passenger_information_display;
		if (v === 'yes' || v === 'no') return v;
		// departures_board=realtime/delay : affichage dynamique ; =no : aucun tableau. Les
		// valeurs timetable (horaires imprimés) et yes (sans précision) ne disent rien des écrans.
		const d = t.departures_board;
		if (d && DYNAMIC_BOARDS.includes(d)) return 'yes';
		if (d === 'no') return 'no';
		return undefined;
	}
	return t[ITEM_KEY[item]] || undefined;
}

/** Partie d'un quai vue par les équipements : ses tags et si elle est couverte. */
export interface EquipmentPart {
	tags: Tags;
	/** Couverte (souterraine ou covered=yes) : la question de l'abri ne la concerne pas. */
	covered: boolean;
}

/** Ce que l'on sait déjà d'un quai, et ce qui manque (quête Q8). */
export interface PlatformEquipment {
	/** Valeur connue de chaque caractéristique (pour préremplir la fiche). */
	known: Partial<Record<PlatformItem, string>>;
	/** Caractéristiques à relever (dans l'ordre de PLATFORM_ITEMS). */
	missing: PlatformItem[];
	/** L'abri se demande : au moins une partie à l'air libre. */
	shelterApplies: boolean;
}

/**
 * État des équipements d'un quai (une partie, ou toutes les parties d'un quai en plusieurs
 * parties). Une caractéristique manque si une partie concernée ne la porte pas, sauf si une
 * autre source la donne :
 * - hauteur et bandes podotactiles : sur un bord de quai relié (railway=platform_edge) ;
 * - abri et bancs : un amenity=shelter / amenity=bench cartographié à part sur le quai (le wiki
 *   réserve shelter=yes/bench=yes à ce qui n'est pas cartographié séparément).
 * L'abri ne concerne que les parties à l'air libre.
 */
export function platformEquipment(
	parts: EquipmentPart[],
	extra: { edges?: Tags[]; shelterMapped?: boolean; benchMapped?: boolean } = {}
): PlatformEquipment {
	const open = parts.filter((p) => !p.covered);
	const shelterApplies = open.length > 0;
	const known: Partial<Record<PlatformItem, string>> = {};
	const missing: PlatformItem[] = [];
	for (const item of PLATFORM_ITEMS) {
		const concerned = item === 'shelter' ? open : parts;
		if (!concerned.length) continue;
		const values = concerned.map((p) => itemValue(item, p.tags));
		const first = values.find((v) => v !== undefined);
		let fromExtra: string | undefined;
		if (item === 'height' || item === 'tactile')
			fromExtra = (extra.edges ?? []).map((t) => itemValue(item, t)).find((v) => v !== undefined);
		if (item === 'shelter' && extra.shelterMapped) fromExtra = 'yes';
		if (item === 'bench' && extra.benchMapped) fromExtra = 'yes';
		const value = first ?? fromExtra;
		if (value !== undefined) known[item] = value;
		if (values.some((v) => v === undefined) && fromExtra === undefined) missing.push(item);
	}
	return { known, missing, shelterApplies };
}

/**
 * Tags à écrire d'après les réponses : seulement ce qui change sur les parties concernées.
 * « Je ne sais pas » (undefined) n'écrit rien et ne retire rien. La hauteur est normalisée
 * (« 0,55 » → « 0.55 »). departures_board n'est jamais écrit ; il n'est retiré que s'il annonce
 * un écran (realtime, delay) alors que l'on répond « Non ». L'abri ne s'écrit que
 * sur les parties à l'air libre (COVERED_OMIT, appliqué par la saisie).
 */
export function platformEquipmentTags(
	input: PlatformEquipmentInput,
	parts: EquipmentPart[]
): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const item of PLATFORM_ITEMS) {
		let v: string | undefined;
		if (item === 'height') {
			const n = parseHeight(input.height);
			v = n === undefined || heightProblem(input.height) ? undefined : formatHeight(n);
		} else v = input[item];
		if (v === undefined) continue;
		const key = ITEM_KEY[item];
		const concerned = item === 'shelter' ? parts.filter((p) => !p.covered) : parts;
		// Déjà connu ainsi sur toutes les parties concernées : rien à changer (des écrans connus
		// par departures_board ne sont pas réécrits). La hauteur se compare telle qu'écrite :
		// « 0,55 » (virgule) est corrigée en « 0.55 ».
		const same = (t: Tags) => (item === 'height' ? t[key] : itemValue(item, t)) === v;
		if (!concerned.length || concerned.every((p) => same(p.tags))) continue;
		out[key] = v;
		// « Pas d'écran » vu sur place alors que departures_board annonce un affichage dynamique :
		// cette valeur contredit le relevé, elle est retirée (les autres valeurs restent).
		if (
			item === 'display' &&
			v === 'no' &&
			concerned.some((p) => DYNAMIC_BOARDS.includes(p.tags.departures_board ?? ''))
		)
			out.departures_board = null;
	}
	return out;
}

/** Clés à ne pas écrire sur une partie couverte (l'abri ne la concerne pas). */
export const COVERED_OMIT = [ITEM_KEY.shelter];

/** Clés écrites par la fiche « Équipements du quai » (pour les résumés). */
export const EQUIPMENT_KEYS = new Set(Object.values(ITEM_KEY));
