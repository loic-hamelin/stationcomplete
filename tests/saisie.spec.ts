import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Lot 2 : saisie locale (numéro de voie, nouvelle pancarte), avec les données réelles d'Ambérieu.
const fixture = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const STATION = 'w67074448';
const WAY = 983664438; // voie « 13Mag », le long d'un quai

type El = { type: string; id: number; lon?: number; lat?: number; nodes?: number[] };
const els = fixture.elements as El[];
const way = els.find((e) => e.type === 'way' && e.id === WAY)!;
// Point de départ : le nœud de la voie le plus proche du centre de l'emprise de la gare.
const [w, so, e, n] = fixture.station.bbox as number[];
const center = [(w + e) / 2, (so + n) / 2];
const mid = way
	.nodes!.map((id) => els.find((x) => x.type === 'node' && x.id === id)!)
	.sort(
		(a, b) =>
			Math.hypot(a.lon! - center[0], a.lat! - center[1]) -
			Math.hypot(b.lon! - center[0], b.lat! - center[1])
	)[0];

async function mockNetwork(page: Page) {
	await page.route('https://api.openstreetmap.org/**', (r) =>
		r.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ elements: fixture.elements })
		})
	);
	await page
		.context()
		.route('https://data.geopf.fr/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: tile }));
}

async function expectAccessible(page: Page, exclude?: string) {
	let b = new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
	if (exclude) b = b.exclude(exclude);
	const { violations } = await b.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

function watchErrors(page: Page) {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

test('hors de la gare, la saisie des numéros est verrouillée', async ({ page }) => {
	await mockNetwork(page);
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await expect(page.getByText('se relèvent sur place')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
	// La vérification reste possible à distance.
	await expect(page.getByRole('button', { name: 'C’est correct' })).toBeEnabled();
	await expectAccessible(page);
});

test('saisir un numéro de voie et une pancarte, puis les retrouver', async ({ page }) => {
	const errors = watchErrors(page);
	await mockNetwork(page);

	// Mode démonstration (pour saisir hors de la gare)
	await page.goto('/reglages/');
	// Un clic arrivé avant que la page soit interactive est perdu : on réessaie tant que
	// l'interrupteur n'est pas activé (sans jamais le désactiver).
	const demo = page.getByRole('switch', { name: 'Mode démonstration' });
	await expect(async () => {
		if ((await demo.getAttribute('aria-checked')) !== 'true') await demo.click();
		await expect(demo).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
	}).toPass();
	await expectAccessible(page);

	// E7 — voie : « Voie 13 » est nettoyé en « 13 »
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await page.getByRole('textbox', { name: 'Numéro de la voie' }).fill('Voie 13');
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);
	await expect(page.locator('.rc-badge.voie.edited')).toHaveText('13');

	// E6 — placer une pancarte sur la même voie
	await page.goto(`/gare/placer/?id=${STATION}&lon=${mid.lon}&lat=${mid.lat}`);
	await expect(page.getByText('Accrochée à la voie')).toBeVisible();
	// Les flèches de 20 cm (alternative au glisser, WCAG 2.5.7) sont repliées derrière un bouton.
	await expect(page.getByRole('button', { name: 'Déplacer la croix vers la droite' })).toHaveCount(
		0
	);
	await page.getByRole('button', { name: 'Ajuster au centimètre' }).click();
	await expect(page.getByRole('button', { name: 'Ajuster au centimètre' })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await page.getByRole('button', { name: 'Déplacer la croix vers la droite' }).click();
	await expect(page.getByText('Accrochée à la voie')).toBeVisible();
	await expectAccessible(page, '.maplibregl-canvas-container');
	await page.getByRole('button', { name: 'Valider la position' }).click();

	// E7 — pancarte « 6 V »
	await expect(page).toHaveURL(/\/gare\/saisie/);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('alert')).toContainText('Choisissez le panneau');
	await page.getByRole('button', { name: 'n V' }).click();
	await page.getByRole('button', { name: '6', exact: true }).click();
	await page
		.getByRole('button', { name: /^Vers l/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'À droite' }).click();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/focus=node\/-1/);
	await expect(page.getByRole('region', { name: 'Objet sélectionné' })).toContainText('6 V');

	// E4 — les saisies sont prises en compte
	await page.goto(`/gare/?id=${STATION}`);
	await expect(page.getByRole('link', { name: /2 saisies en attente/ })).toBeVisible();
	await expect(page.getByLabel('Complétude de la gare')).toContainText('1/6');

	// E9 — contributions : retirer une saisie
	await page.getByRole('link', { name: /Contributions/ }).click();
	await expect(page.getByText('Voie 13')).toBeVisible();
	await expect(page.getByText('Pancarte « 6 V »')).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Retirer : Voie 13' }).click();
	await page.getByRole('button', { name: 'Confirmer' }).click();
	await expect(page.getByText('Voie 13')).toHaveCount(0);

	// Les saisies survivent au rechargement
	await page.reload();
	await expect(page.getByText('Pancarte « 6 V »')).toBeVisible();
	expect(errors).toEqual([]);
});
