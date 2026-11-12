import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Lot S1 (D4 bis) : état officiel des ascenseurs et escaliers mécaniques sur la page de la gare
// (E4), lu en lecture seule chez l'exploitant. La source SNCF est simulée avec une fixture
// RÉDIGÉE d'après la documentation (pas un échantillon réel : voir son champ « _note »).
// Gare : Ambérieu-en-Bugey (API OSM et photos simulées, comme gare.spec.ts).
const AMB_ID = 'w67074448';
const SNCF = 'https://ressources.data.sncf.com';
const osm = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const sncf = JSON.parse(readFileSync('tests/fixtures/sncf-etat-officiel-redige.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const config = JSON.parse(readFileSync('static/config.json', 'utf8'));

type Mode = 'ok' | 'down' | 'uncovered';

/** Réseau simulé ; renvoie les requêtes faites à la source officielle. */
async function mockNetwork(page: Page, mode: Mode = 'ok') {
	const ctx: BrowserContext = page.context();
	// L'affichage est publié coupé (en attente de vérification par Loïc) : les tests l'activent.
	await ctx.route('**/config.json', (route) =>
		route.fulfill({ json: { ...config, officialStatusEnabled: true } })
	);
	await ctx.route('https://api.openstreetmap.org/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ version: '0.6', elements: osm.elements })
		})
	);
	await ctx.route('https://data.geopf.fr/**', (route) =>
		route.fulfill({
			contentType: 'image/jpeg',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: tile
		})
	);
	const requests: Request[] = [];
	await ctx.route(`${SNCF}/**`, (route) => {
		requests.push(route.request());
		if (mode === 'down') return route.abort('connectionrefused');
		const url = route.request().url();
		const body = url.includes('/gares-de-voyageurs/')
			? mode === 'uncovered'
				? { total_count: 0, results: [] }
				: sncf.stations
			: sncf.status;
		return route.fulfill({
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify(body)
		});
	});
	return requests;
}

function watchErrors(page: Page) {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

const section = (page: Page, name = 'Ascenseurs et escaliers mécaniques — état officiel') =>
	page.getByRole('region', { name });

test('liste officielle : états (icône et texte), heure, source, canaux de signalement', async ({
	page
}, info) => {
	const errors = watchErrors(page);
	const requests = await mockNetwork(page);
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambérieu-en-Bugey');

	const s = section(page);
	await expect(s).toBeVisible();
	await expect(s).toContainText('3 équipements · 1 hors service');
	const items = s.getByRole('listitem');
	await expect(items).toHaveCount(3);
	// Hors service d'abord ; libellés tels que publiés ; l'autre gare et la ligne sans nom ignorées
	await expect(items.nth(0)).toContainText('Hors service');
	await expect(items.nth(0)).toContainText('Ascenseur - Quai 2/3');
	await expect(items.nth(0)).toContainText('Voies 2 et 3 / Souterrain');
	await expect(items.nth(1)).toContainText('Statut inconnu');
	await expect(items.nth(2)).toContainText('En service');
	await expect(items.nth(0).locator('svg')).toHaveCount(1);
	await expect(s).not.toContainText('autre gare');
	await expect(s).toContainText(/Lu le \d{2}\/\d{2}\/\d{4}/);
	await expect(s).toContainText('Source : SNCF Gares & Connexions (ODbL)');
	await expect(s.getByRole('link', { name: 'SNCF Gares & Connexions' })).toHaveAttribute(
		'href',
		/data\.gouv\.fr/
	);

	// Requêtes : deux lectures GET filtrées sur la gare, sans cookie ni adresse de la page
	expect(requests).toHaveLength(2);
	for (const r of requests) {
		expect(r.method()).toBe('GET');
		const h = await r.allHeaders();
		expect(h.cookie).toBeUndefined();
		expect(h.referer).toBeUndefined();
		expect(new URL(r.url()).searchParams.get('where')).toBeTruthy();
	}
	expect(new URL(requests[1].url()).searchParams.get('where')).toBe('id_gare="fictif-amberieu"');

	// Signaler une panne : canaux officiels de l'exploitant, numéro affiché en texte
	await s.getByText('Signaler une panne', { exact: true }).click();
	await expect(s).toContainText('stationcomplete ne transmet rien à l’exploitant');
	await expect(s.getByRole('link', { name: 'Site SNCF Gares & Connexions' })).toHaveAttribute(
		'href',
		'https://www.garesetconnexions.sncf/fr/gares-services'
	);
	await expect(
		s.getByRole('link', { name: 'Formulaire de contact SNCF Gares & Connexions' })
	).toBeVisible();
	await expect(s.getByText('3212', { exact: true })).toBeVisible();
	await expect(s.getByText('+33 9 72 72 00 92', { exact: true })).toBeVisible();
	// Rien d'officiel sur la carte (pas de position) : seulement cette liste
	await expectAccessible(page);
	await s.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `test-results/etat-officiel-${info.project.name}.png` });

	// Thème sombre
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectAccessible(page);

	// Gardé 10 minutes en mémoire : revenir sur la gare ne relit pas la source
	await page.getByRole('link', { name: 'Changer de gare' }).click();
	await expect(page).toHaveURL(/\/gares\/?$/);
	await page.goBack();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambérieu-en-Bugey');
	await expect(section(page).getByRole('listitem')).toHaveCount(3);
	expect(requests).toHaveLength(2);
	expect(errors).toEqual([]);
});

test('source injoignable : message discret, le reste de la page fonctionne', async ({ page }) => {
	await mockNetwork(page, 'down');
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
	const s = section(page);
	await expect(s).toContainText('État officiel indisponible pour le moment.');
	await expect(s.getByRole('listitem')).toHaveCount(0);
	// Les canaux officiels restent proposés
	await expect(s.getByText('Signaler une panne', { exact: true })).toBeVisible();
	await expectAccessible(page);
});

test('gare non couverte : rien n’est affiché', async ({ page }) => {
	const requests = await mockNetwork(page, 'uncovered');
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
	await expect.poll(() => requests.length).toBe(1);
	await expect(page.getByText('état officiel')).toHaveCount(0);
});

test('coupé par config.json : rien n’est lu ni affiché', async ({ page }) => {
	const requests = await mockNetwork(page);
	await page
		.context()
		.route('**/config.json', (route) =>
			route.fulfill({ json: { ...config, officialStatusEnabled: false } })
		);
	const cfg = page.waitForResponse((r) => r.url().endsWith('/config.json'));
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
	await cfg;
	// Le composant décide juste après la lecture de config.json : on lui laisse un instant.
	await page.waitForTimeout(300);
	await expect(page.getByText('état officiel')).toHaveCount(0);
	expect(requests).toHaveLength(0);
});

test('pas de défilement horizontal à 320 px, signalement ouvert', async ({ page }) => {
	await mockNetwork(page);
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto(`/gare/?id=${AMB_ID}`);
	const s = section(page);
	await expect(s.getByRole('listitem')).toHaveCount(3);
	await s.getByText('Signaler une panne', { exact: true }).click();
	await expect(s.getByText('3212', { exact: true })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('en anglais', () => {
	test.use({ locale: 'en-GB' });
	test('official list and reporting channels', async ({ page }) => {
		await mockNetwork(page);
		await page.goto(`/gare/?id=${AMB_ID}`);
		const s = section(page, 'Lifts and escalators — official status');
		await expect(s).toContainText('3 items · 1 out of service');
		await expect(s.getByRole('listitem').first()).toContainText('Out of service');
		await expect(s.getByRole('listitem').nth(1)).toContainText('Status unknown');
		await expect(s).toContainText('Source: SNCF Gares & Connexions (ODbL)');
		await s.getByText('Report a breakdown', { exact: true }).click();
		await expect(s).toContainText('every day from 8:00 to 20:00');
		await expect(s.getByText('3212', { exact: true })).toBeVisible();
		await expectAccessible(page);
	});
});
