// Calcule les contrastes des jetons de couleur (formule WCAG 2.x) pour docs/ux-spec.md § 5.1.
// Usage : node scripts/contrast.mjs   (lit les jetons dans src/app.css, clair et sombre)

import { readFileSync } from 'node:fs';

const css = readFileSync('src/app.css', 'utf8');
/** Jetons d'un bloc CSS (premier bloc qui suit le sélecteur donné). */
function tokens(selector) {
	const start = css.indexOf(selector);
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
	);
}
const light = tokens(':root {');
const dark = { ...light, ...tokens(":root[data-theme='dark']") };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => {
	const [r, g, b] = rgb(h).map(lin);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

const PAIRS = [
	['text', 'bg'],
	['text', 'surface'],
	['text-2', 'bg'],
	['text-2', 'surface'],
	['text-2', 'surface-2', 'bouton désactivé'],
	['text-3', 'bg'],
	['primary', 'bg', 'liens, bouton discret'],
	['primary', 'surface'],
	['primary', 'primary-soft', 'choix sélectionné'],
	['on-primary', 'primary', 'bouton principal'],
	['quai', 'bg'],
	['quai', 'quai-soft'],
	['voie', 'bg'],
	['voie', 'voie-soft', 'jetons E7'],
	['pancarte', 'bg'],
	['pancarte', 'pancarte-soft'],
	['equip', 'bg', 'équipements'],
	['equip', 'equip-soft'],
	['ok', 'bg'],
	['missing', 'bg'],
	['missing', 'missing-soft'],
	['danger', 'bg'],
	['danger', 'danger-soft'],
	['on-danger', 'danger', 'bouton « Tout effacer »'],
	['text', 'missing-soft', 'bandeau'],
	['text', 'danger-soft', 'bandeau'],
	['border-strong', 'bg', 'contour de champ, 1.4.11'],
	['knob', 'border-strong', 'interrupteur éteint, 1.4.11'],
	['primary', 'surface-2', 'interrupteur allumé sur fond, 1.4.11']
];

const f = (n) => n.toFixed(2).replace('.', ',') + ':1';
console.log('| Paire (texte / fond) | Clair | Sombre | Usage |');
console.log('| --- | --- | --- | --- |');
for (const [a, b, use = ''] of PAIRS)
	console.log(
		`| \`${a}\` / \`${b}\` | ${f(ratio(light[a], light[b]))} | ${f(ratio(dark[a], dark[b]))} | ${use} |`
	);
