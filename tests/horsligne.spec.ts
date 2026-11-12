import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Lot 4 : gare téléchargée (données + photos), saisie sans réseau, envoi au retour du réseau.
const fixture = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const STATION = 'w67074448';
const WAY = 983664438;
const DEV = 'https://master.apis.dev.openstreetmap.org';
type El = { type: string; id: number; version?: number };
const freshWay = (fixture.elements as El[]).find((e) => e.type === 'way' && e.id === WAY)!;

async function mockTiles(page: Page) {
	let n = 0;
	// Au niveau du contexte : les requêtes passent par le service worker, qui les relaie.
	await page.context().route('https://data.geopf.fr/**', (r) => {
		n++;
		return r.fulfill({
			contentType: 'image/jpeg',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: tile
		});
	});
	return () => n;
}

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('télécharger une gare puis la consulter, carte comprise, sans réseau', async ({
	page,
	context
}) => {
	await page.route('https://api.openstreetmap.org/**', (r) =>
		r.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ elements: fixture.elements })
		})
	);
	const tiles = await mockTiles(page);
	await page.goto(`/gare/?id=${STATION}`);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.getByRole('button', { name: /Emporter la gare hors-ligne/ }).click();
	await expect(page.getByText('Disponible hors-ligne')).toBeVisible({ timeout: 30_000 });
	const fetched = tiles();
	expect(fetched).toBeGreaterThan(50);
	const cached = await page.evaluate(
		async () => (await (await caches.open('rc-tiles')).keys()).length
	);
	expect(cached).toBe(fetched);

	// Mode avion
	await context.setOffline(true);
	await page.unrouteAll();
	await context.unrouteAll();
	const failedTiles: string[] = [];
	const servedTiles: string[] = [];
	page.on('requestfailed', (r) => r.url().includes('data.geopf.fr') && failedTiles.push(r.url()));
	page.on(
		'response',
		(r) => r.url().includes('data.geopf.fr') && r.ok() && servedTiles.push(r.url())
	);
	await page.goto(`/gare/carte/?id=${STATION}`);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	// Les photos demandées par la carte (depuis son worker) sont servies sans réseau.
	await expect.poll(() => servedTiles.length, { timeout: 10_000 }).toBeGreaterThan(0);
	// Aucune photo de la zone téléchargée ne manque (celles hors zone peuvent échouer).
	const inArea = await page.evaluate(async (urls) => {
		const keys = new Set((await (await caches.open('rc-tiles')).keys()).map((r) => r.url));
		return urls.filter((u) => keys.has(u));
	}, failedTiles);
	expect(inArea).toEqual([]);
	await expect(page.locator('.rc-badge').first()).toBeAttached();
	await expect(page.getByText(/Hors-ligne — vos saisies restent/)).toBeVisible();
	// Une photo de la gare est servie par le service worker, sans réseau.
	const ok = await page.evaluate(async () => {
		const u = (await (await caches.open('rc-tiles')).keys())[0].url;
		return (await fetch(u, { mode: 'cors' })).ok;
	});
	expect(ok).toBe(true);

	// Gare listée dans les réglages
	await page.goto('/reglages/');
	await expect(
		page.getByRole('button', { name: 'Supprimer Ambérieu-en-Bugey du téléphone' })
	).toBeVisible();
});

test('envoi programmé hors-ligne : il part tout seul au retour du réseau', async ({
	page,
	context
}) => {
	await page.addInitScript((dev) => {
		localStorage.setItem('rc:server', JSON.stringify('dev'));
		localStorage.setItem('rc:user:dev', JSON.stringify({ name: 'testeur', id: 1 }));
		localStorage.setItem(dev + 'oauth2_access_token', 'jeton-de-test');
	}, DEV);
	await mockTiles(page);
	let uploads = 0;
	await page.route(`${DEV}/api/0.6/**`, async (route) => {
		const p = new URL(route.request().url()).pathname;
		const json = (o: unknown) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
		if (p.endsWith('/map.json')) return json({ elements: fixture.elements });
		if (p.endsWith('/ways.json')) return json({ elements: [freshWay] });
		if (p.endsWith('/changeset/create')) return route.fulfill({ body: '77' });
		if (p.endsWith('/changeset/77/upload')) {
			uploads++;
			return route.fulfill({ contentType: 'text/xml', body: '<diffResult/>' });
		}
		if (p.endsWith('/close')) return route.fulfill({ body: '' });
		return route.fulfill({ status: 404, body: '' });
	});

	// Saisie (gare déjà chargée), puis passage en mode avion
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await page.getByRole('textbox', { name: 'Numéro de la voie' }).fill('13');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);
	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Envoyer dès le retour du réseau' }).click();
	await expect(page.getByText('En attente du réseau : l’envoi partira tout seul.')).toBeVisible();
	expect(uploads).toBe(0);

	// Retour du réseau
	await context.setOffline(false);
	await expect(page.getByText(/1 modification envoyée automatiquement/)).toBeVisible({
		timeout: 15_000
	});
	expect(uploads).toBe(1);
	await expect(page.getByText('Aucune saisie en attente pour cette gare.')).toBeVisible();
});
