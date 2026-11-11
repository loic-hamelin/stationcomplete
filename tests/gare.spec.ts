import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Parcours du lot 1 (lecture seule) avec des données réelles d'Ambérieu-en-Bugey :
// l'API OSM et les tuiles IGN sont simulées pour que le test ne dépende pas du réseau.
const fixture = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');

async function mockNetwork(page: Page) {
	await page.route('https://api.openstreetmap.org/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ version: '0.6', elements: fixture.elements })
		})
	);
	await page.context().route('https://data.geopf.fr/**', (route) =>
		route.fulfill({
			contentType: 'image/jpeg',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: tile
		})
	);
}

function watchErrors(page: Page) {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

async function expectAccessible(page: Page, exclude?: string) {
	let b = new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
	if (exclude) b = b.exclude(exclude);
	const { violations } = await b.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

test('chercher une gare, voir ce qui manque, ouvrir la carte', async ({ page }) => {
	const errors = watchErrors(page);
	await mockNetwork(page);

	// E3 — recherche
	await page.goto('/gares/');
	await page.getByRole('searchbox', { name: 'Rechercher une gare' }).fill('amberieu');
	await page
		.getByRole('link', { name: /Ambérieu-en-Bugey/ })
		.first()
		.click();

	// E4 — tableau de bord
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambérieu-en-Bugey');
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
	await expect(page.getByRole('link', { name: /sans pancarte d’arrêt/ })).toBeVisible();
	await expectAccessible(page);
	await page.screenshot({ path: 'test-results/e4.png' });

	// E5 — carte, ouverte depuis une quête : elle se centre sur l'objet et ouvre sa fiche
	await page.getByRole('link', { name: /Deux voies portent le numéro 2/ }).click();
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	// 12 objets des quêtes, plus 11 voies numérotées qui ne longent aucun quai (lot 7d :
	// toutes les voies sont dessinées, étiquette seulement si elles portent un numéro)
	await expect(page.locator('.rc-badge')).toHaveCount(23 + 12);
	// (dont 12 équipements : 6 ascenseurs, 3 distributeurs de billets, 3 escaliers, lot Équipements)
	await expect(page.locator('.rc-badge.equip')).toHaveCount(12);
	const sheet = page.getByRole('region', { name: 'Objet sélectionné' });
	await expect(sheet).toContainText('Voie 2');
	await expect(sheet).toContainText('Numéro de voie en double');
	await page.screenshot({ path: 'test-results/e5.png' });

	// Filtres
	await page.getByRole('button', { name: /Voies/ }).click();
	await expect(page.locator('.rc-badge.voie').first()).toBeHidden();

	// La carte MapLibre (canevas et marqueurs) est exclue : axe ne sait pas évaluer un canevas.
	await expectAccessible(page, '.maplibregl-canvas-container');
	expect(errors).toEqual([]);
});

test('une gare déjà consultée reste lisible sans réseau', async ({ page, context }) => {
	await mockNetwork(page);
	await page.goto('/gares/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.goto('/gare/?id=w67074448');
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
	await context.setOffline(true);
	await page.unrouteAll();
	await page.reload();
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
});
