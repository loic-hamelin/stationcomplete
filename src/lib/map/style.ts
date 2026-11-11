// Style de carte partagé par StationMap (E5), PlacementMap (E6) et DrawMap (E11) — refonte v1.
// Principe : la photo aérienne reste intacte ; chaque objet = trait clair + liseré sombre (≥ 3:1 sur
// béton comme sur ballast). La carte ne change pas avec le thème : seuls les contrôles flottants
// passent en sombre. Valeurs : docs/ux-spec.md § 5.3 (spécification de la refonte, § 3).

import type { ExpressionSpecification, RasterSourceSpecification } from 'maplibre-gl';
import type { Imagery } from '#lib/core/countries.js';
import { t } from '../i18n/t.js';

export const MAP = {
	voie: '#E4E0FF', // lavande très pâle (famille voie)
	quai: '#B5EDE4', // vert d'eau très pâle (famille quai)
	edited: '#B3C8FF', // bleu pâle : modifié par vous, en attente d'envoi (décision 4)
	alert: '#FF6A5C', // pastille « ! » des étiquettes
	sel: '#FFF700', // jaune OSRD highlight-30 : sélection, accrochage
	casing: '#14110E', // liseré
	plate: '#FFFFFF', // plaque de pancarte
	equip: '#8CBFE6', // équipements (ascenseur, distributeur), sous z18
	ground: '#8C877C' // fond sous la photo, le temps qu'elle arrive
} as const;

type Stops = [number, number][];

/** Épaisseur interpolée selon le zoom (px CSS). */
export const W = (stops: Stops): ExpressionSpecification =>
	['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;
export const plus = (stops: Stops, d: number): Stops => stops.map(([z, w]) => [z, w + d]);

/** Épaisseurs par zoom (spécification de la refonte, § 3.3). */
export const VOIE_W: Stops = [
	[15, 0.75],
	[17, 1.25],
	[18, 1.6],
	[19, 2],
	[21, 3]
];
export const QUAI_W: Stops = [
	[15, 0.75],
	[17, 1],
	[18, 1.25],
	[19, 1.5],
	[21, 2]
];

/**
 * Objets souterrains (lot 7d) : pointillés ET estompés, sur les cartes E5, E6, E11 et E12.
 * Les pointillés ne signalent rien d'autre (convention cartographique : souterrain).
 */
export const UNDER_DASH: [number, number] = [2, 2];
export const UNDER_LINE = 0.6;
export const UNDER_CASING = 0.3;

export const IS_SEL: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

/** Source MapLibre de la photo aérienne du pays de la gare (configuration des pays). */
export const photoSource = (im: Imagery): RasterSourceSpecification => ({
	type: 'raster',
	tiles: [im.tileUrl],
	tileSize: im.tileSize,
	maxzoom: im.maxZoom,
	attribution: im.attribution
});
/** Attribution des données OSM sur la carte, dans la langue de l'interface. */
export const osmAttribution = () => t('map.osmAttribution');
/** Textes de l'interface de MapLibre (bouton d'attribution), dans la langue de l'interface. */
export const mapLocale = () => ({
	'AttributionControl.ToggleAttribution': t('map.toggleAttribution')
});

/** Rectangle à l'écran, en px relatifs au conteneur de la carte. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}
const overlap = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Rectangles des contrôles flottants posés sur la carte (marqués `data-map-avoid`), pour que les
 * étiquettes ne passent pas dessous.
 */
export function avoidBoxes(container: HTMLElement): Box[] {
	const root = container.getBoundingClientRect();
	const scope = container.closest('[data-map-scope]') ?? container.parentElement ?? container;
	return [...scope.querySelectorAll<HTMLElement>('[data-map-avoid]')]
		.map((el) => el.getBoundingClientRect())
		.filter((r) => r.width && r.height)
		.map((r) => ({ x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }));
}

export interface LabelCandidate {
	/** Taille du visuel de l'étiquette (px). */
	w: number;
	h: number;
	/** Positions possibles à l'écran, dans l'ordre de préférence (centre de l'étiquette). */
	points: { x: number; y: number }[];
}

/**
 * Évitement des collisions, calculé à la fin d'un déplacement (moveend) : chaque étiquette, dans
 * l'ordre de priorité, prend la première position libre (à 12 px des bords, hors des contrôles
 * flottants, sans toucher une étiquette déjà placée) ; sinon elle est masquée.
 * Renvoie, pour chaque étiquette, l'indice de la position retenue ou -1. O(n²), n ≈ quelques dizaines.
 */
export function placeLabels(
	labels: LabelCandidate[],
	view: { w: number; h: number },
	avoid: Box[],
	margin = 12
): number[] {
	const placed: Box[] = [...avoid];
	return labels.map((l) => {
		const w = l.w + 6,
			h = Math.max(l.h, 24);
		for (let i = 0; i < l.points.length; i++) {
			const p = l.points[i];
			const b = { x: p.x - w / 2, y: p.y - h / 2, w, h };
			if (b.x < margin || b.y < margin || b.x + w > view.w - margin || b.y + h > view.h - margin)
				continue;
			if (placed.some((o) => overlap(b, o))) continue;
			placed.push(b);
			return i;
		}
		return -1;
	});
}

type XY = { x: number; y: number };

/**
 * Partie visible d'une ligne à l'écran : la plus longue suite de segments découpés au rectangle
 * de la vue (Liang-Barsky). Sert à placer l'étiquette d'une longue voie sur ce qu'on en voit.
 */
export function visiblePart(pts: XY[], view: { w: number; h: number }): XY[] {
	const runs: XY[][] = [];
	let run: XY[] = [];
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1],
			b = pts[i];
		const dx = b.x - a.x,
			dy = b.y - a.y;
		let t0 = 0,
			t1 = 1,
			ok = true;
		for (const [p, q] of [
			[-dx, a.x],
			[dx, view.w - a.x],
			[-dy, a.y],
			[dy, view.h - a.y]
		]) {
			if (p === 0) {
				if (q < 0) ok = false;
			} else {
				const r = q / p;
				if (p < 0) t0 = Math.max(t0, r);
				else t1 = Math.min(t1, r);
			}
		}
		if (!ok || t0 > t1) {
			if (run.length) runs.push(run);
			run = [];
			continue;
		}
		const s = { x: a.x + dx * t0, y: a.y + dy * t0 },
			e = { x: a.x + dx * t1, y: a.y + dy * t1 };
		if (!run.length) run.push(s);
		run.push(e);
		if (t1 < 1) {
			runs.push(run);
			run = [];
		}
	}
	if (run.length) runs.push(run);
	const length = (r: XY[]) =>
		r.reduce((n, p, i) => (i ? n + Math.hypot(p.x - r[i - 1].x, p.y - r[i - 1].y) : 0), 0);
	return runs.sort((x, y) => length(y) - length(x))[0] ?? [];
}

/** Points le long d'une ligne (coordonnées écran) aux fractions données de sa longueur. */
export function alongLine(pts: { x: number; y: number }[], fractions: number[]) {
	const seg: number[] = [];
	let total = 0;
	for (let i = 1; i < pts.length; i++) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		seg.push(d);
		total += d;
	}
	if (!total) return pts.slice(0, 1);
	return fractions.map((f) => {
		let rest = f * total;
		for (let i = 0; i < seg.length; i++) {
			if (rest <= seg[i] || i === seg.length - 1) {
				const t = seg[i] ? Math.min(rest / seg[i], 1) : 0;
				return {
					x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
					y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
				};
			}
			rest -= seg[i];
		}
		return pts[pts.length - 1];
	});
}
