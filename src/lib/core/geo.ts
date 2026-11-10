// Géométrie plane locale (en mètres) autour d'un point de référence. À l'échelle d'une gare
// (≤ 2 km), une projection équirectangulaire est précise à quelques centimètres près.

export type Pt = { x: number; y: number };

const R = 6_371_008.8; // rayon moyen de la Terre (m)
const RAD = Math.PI / 180;

export class LocalProjection {
	// Champs déclarés à la main (pas de « readonly » en paramètre) : TypeScript « effaçable »,
	// chargeable par Node sans compilation (scripts/build-stations.mjs, via quests.ts).
	readonly lon0: number;
	readonly lat0: number;
	private readonly kx: number;
	private readonly ky = R * RAD;
	constructor(lon0: number, lat0: number) {
		this.lon0 = lon0;
		this.lat0 = lat0;
		this.kx = R * RAD * Math.cos(lat0 * RAD);
	}
	project(lon: number, lat: number): Pt {
		return { x: (lon - this.lon0) * this.kx, y: (lat - this.lat0) * this.ky };
	}
	unproject(p: Pt): [number, number] {
		return [p.x / this.kx + this.lon0, p.y / this.ky + this.lat0];
	}
}

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Projection orthogonale de P sur le segment AB : paramètre t ∈ [0, 1] et point projeté. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt) {
	const ab = sub(b, a);
	const l2 = dot(ab, ab);
	const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
	return { t, point: { x: a.x + t * ab.x, y: a.y + t * ab.y } };
}

export const distToSegment = (p: Pt, a: Pt, b: Pt) => dist(p, projectOnSegment(p, a, b).point);

/** Distance minimale entre deux segments (0 s'ils se croisent). */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt) {
	if (segmentsIntersect(a, b, c, d)) return 0;
	return Math.min(
		distToSegment(a, c, d),
		distToSegment(b, c, d),
		distToSegment(c, a, b),
		distToSegment(d, a, b)
	);
}

export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt) {
	const d1 = cross(sub(b, a), sub(c, a));
	const d2 = cross(sub(b, a), sub(d, a));
	const d3 = cross(sub(d, c), sub(a, c));
	const d4 = cross(sub(d, c), sub(b, c));
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Distance d'un segment à une polyligne (ou au contour d'un polygone). */
export function segmentToPolyline(a: Pt, b: Pt, line: Pt[]) {
	let m = Infinity;
	for (let i = 0; i + 1 < line.length; i++)
		m = Math.min(m, segmentDistance(a, b, line[i], line[i + 1]));
	return m;
}

/** Angle non orienté entre deux directions, ramené à [0°, 90°]. */
export function lineAngleDeg(u: Pt, v: Pt) {
	const c = Math.abs(dot(u, v)) / (len(u) * len(v) || 1);
	return Math.acos(Math.min(1, c)) / RAD;
}

export function pointInPolygon(p: Pt, ring: Pt[]) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i],
			b = ring[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
			inside = !inside;
	}
	return inside;
}

/**
 * Axe principal d'un nuage de points (analyse en composantes principales) : centre, direction
 * unitaire, étendue le long de l'axe [min, max] et largeur. Sert d'axe aux quais.
 */
export function principalAxis(points: Pt[]) {
	const n = points.length;
	const c = points.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
	let sxx = 0,
		syy = 0,
		sxy = 0;
	for (const p of points) {
		const dx = p.x - c.x,
			dy = p.y - c.y;
		sxx += dx * dx;
		syy += dy * dy;
		sxy += dx * dy;
	}
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const u = { x: Math.cos(theta), y: Math.sin(theta) };
	const nrm = { x: -u.y, y: u.x };
	let min = Infinity,
		max = -Infinity,
		wmin = Infinity,
		wmax = -Infinity;
	for (const p of points) {
		const d = sub(p, c);
		const s = dot(d, u),
			w = dot(d, nrm);
		min = Math.min(min, s);
		max = Math.max(max, s);
		wmin = Math.min(wmin, w);
		wmax = Math.max(wmax, w);
	}
	return { center: c, u, min, max, length: max - min, width: wmax - wmin };
}
