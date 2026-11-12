import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Lot traduction : langue choisie dans les Réglages (E10), puis parcours principal sur la gare
// d'Ambérieu-en-Bugey (API OSM et photos simulées) ; détection d'après la langue du téléphone.
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

test.beforeEach(({ page }) => sansEtatOfficiel(page));

const PARCOURS = {
	en: {
		settings: 'Settings',
		search: 'Search for a station',
		gauges: 'Station completeness',
		quest: /side without a stop marker|sides without a stop marker/,
		duplicate: /Two tracks have the number 2/,
		sheet: 'Selected object',
		track: 'Track 2',
		fact: 'Duplicate or inconsistent track number',
		filter: /Tracks/,
		nav: 'Main navigation'
	},
	de: {
		settings: 'Einstellungen',
		search: 'Bahnhof suchen',
		gauges: 'Vollständigkeit des Bahnhofs',
		quest: /Bahnsteigseiten? ohne Haltetafel/,
		duplicate: /Zwei Gleise tragen die Nummer 2/,
		sheet: 'Ausgewähltes Objekt',
		track: 'Gleis 2',
		fact: 'Doppelte oder widersprüchliche Gleisnummer',
		filter: /Gleise/,
		nav: 'Hauptnavigation'
	}
} as const;

for (const [lang, txt] of Object.entries(PARCOURS)) {
	test(`parcours principal en ${lang} : Réglages, gare, carte, fiche`, async ({ page }) => {
		const errors = watchErrors(page);
		await mockNetwork(page);

		// E10 — choisir la langue (libellé en français au départ : téléphone réglé en français)
		await page.goto('/reglages/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		// Choix refait tant que la page n'est pas hydratée (sous charge, le premier peut précéder
		// l'attachement des gestionnaires d'événements).
		const h1 = page.getByRole('heading', { level: 1 });
		await expect(async () => {
			if ((await h1.textContent()) !== txt.settings)
				await page.getByLabel(/^(Langue|Language)/).selectOption(lang);
			await expect(h1).toHaveText(txt.settings, { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await expect(page.locator('html')).toHaveAttribute('lang', lang);
		await expect(page.getByRole('navigation', { name: txt.nav })).toBeVisible();
		expect(await page.evaluate(() => localStorage.getItem('rc:lang'))).toBe(JSON.stringify(lang));
		await expectAccessible(page);
		if (lang === 'en')
			await page.screenshot({ path: 'test-results/reglages-en.png', fullPage: true });

		// E3 — recherche (la langue reste choisie d'une page à l'autre, rechargement compris)
		await page.goto('/gares/');
		await expect(page.locator('html')).toHaveAttribute('lang', lang);
		await page.getByRole('searchbox', { name: txt.search }).fill('amberieu');
		await page
			.getByRole('link', { name: /Ambérieu-en-Bugey/ })
			.first()
			.click();

		// E4 — tableau de bord
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambérieu-en-Bugey');
		await expect(page.getByLabel(txt.gauges)).toContainText('4/4');
		await expect(page.getByRole('link', { name: txt.quest })).toBeVisible();
		await expectAccessible(page);

		// E5 — carte ouverte depuis une quête, fiche de l'objet
		await page.getByRole('link', { name: txt.duplicate }).click();
		await expect(page.locator('.maplibregl-canvas')).toBeVisible();
		await expect(page.locator('.rc-badge')).toHaveCount(23 + 12);
		// (dont 12 équipements : 6 ascenseurs, 3 distributeurs de billets, 3 escaliers, lot Équipements)
		await expect(page.locator('.rc-badge.equip')).toHaveCount(12);
		const sheet = page.getByRole('region', { name: txt.sheet });
		await expect(sheet).toContainText(txt.track);
		await expect(sheet).toContainText(txt.fact);
		await page.getByRole('button', { name: txt.filter }).click();
		await expect(page.locator('.rc-badge.voie').first()).toBeHidden();
		await expectAccessible(page, '.maplibregl-canvas-container');
		expect(errors).toEqual([]);
	});
}

test.describe('détection d’après la langue du téléphone', () => {
	test.use({ locale: 'de-CH' });
	test('téléphone en allemand de Suisse : interface en allemand', async ({ page }) => {
		await page.goto('/a-propos/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Über stationcomplete');
	});
});

test.describe('langue non disponible', () => {
	test.use({ locale: 'pt-BR' });
	test('téléphone en portugais : interface en anglais, puis retour au français', async ({
		page
	}) => {
		await page.goto('/reglages/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		const h1 = page.getByRole('heading', { level: 1 });
		await expect(async () => {
			if ((await h1.textContent()) !== 'Réglages')
				await page.getByLabel(/^(Langue|Language)/).selectOption('fr');
			await expect(h1).toHaveText('Réglages', { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await page.reload();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Réglages');
	});
});
