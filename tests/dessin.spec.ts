import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Lot 5 : dessiner un quai absent d'OSM (Planès : aucun quai cartographié), puis l'envoyer.
const fixture = JSON.parse(readFileSync('tests/fixtures/planes.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const STATION = 'n35331128';
const DEV = 'https://master.apis.dev.openstreetmap.org';

async function setup(page: Page) {
	await page.addInitScript((dev) => {
		localStorage.setItem('rc:server', JSON.stringify('dev'));
		localStorage.setItem('rc:user:dev', JSON.stringify({ name: 'testeur', id: 1 }));
		localStorage.setItem(dev + 'oauth2_access_token', 'jeton-de-test');
	}, DEV);
	await page.context().route('https://data.geopf.fr/**', (r) =>
		r.fulfill({
			contentType: 'image/jpeg',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: tile
		})
	);
	const uploads: string[] = [];
	await page.route(`${DEV}/api/0.6/**`, async (route) => {
		const req = route.request();
		const p = new URL(req.url()).pathname;
		if (p.endsWith('/map.json'))
			return route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({ elements: fixture.elements })
			});
		if (p.endsWith('/changeset/create')) return route.fulfill({ body: '88' });
		if (p.endsWith('/changeset/88/upload')) {
			uploads.push(req.postData() ?? '');
			return route.fulfill({ contentType: 'text/xml', body: '<diffResult/>' });
		}
		if (p.endsWith('/close')) return route.fulfill({ body: '' });
		return route.fulfill({ status: 404, body: '' });
	});
	return uploads;
}

/**
 * Déplace la vue de la carte avec les flèches du clavier (100 px par appui, environ 45 m au
 * zoom 18) : la croix, fixe au centre de l'écran, vise alors un autre endroit.
 * Fonctionne aussi sur le profil tactile, où la souris ne fait pas glisser la carte.
 */
async function pan(page: Page, right: number, down: number) {
	const keys = [
		...Array(Math.abs(right)).fill(right > 0 ? 'ArrowRight' : 'ArrowLeft'),
		...Array(Math.abs(down)).fill(down > 0 ? 'ArrowDown' : 'ArrowUp')
	];
	// Un appui à la fois, en attendant la fin du glissement : deux appuis rapprochés
	// se fondraient en un seul déplacement, plus court, et le tracé varierait d'un essai à l'autre.
	for (const key of keys) await press(page, key);
}

async function press(page: Page, key: string) {
	const box = page.locator('.mapbox');
	const before = await box.getAttribute('data-center');
	await page.locator('.maplibregl-canvas').focus();
	await page.keyboard.press(key);
	await expect(box).not.toHaveAttribute('data-center', before ?? '');
	let last = '';
	await expect
		.poll(
			async () => {
				const now = (await box.getAttribute('data-center')) ?? '';
				const stable = now === last;
				last = now;
				return stable;
			},
			{ intervals: [250] }
		)
		.toBe(true);
}

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('dessiner un quai sur une gare sans quai, puis l’envoyer', async ({ page }) => {
	const uploads = await setup(page);

	// E4 : la quête Q0 mène au dessin
	await page.goto(`/gare/?id=${STATION}`);
	await page.getByRole('link', { name: /Aucun quai cartographié/ }).click();
	await expect(page).toHaveURL(/\/gare\/dessiner/);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();

	// Rectangle d'environ 90 m × 45 m : 4 points, la vue se déplace entre chaque point
	const add = page.getByRole('button', { name: 'Ajouter un point' });
	await add.click();
	await pan(page, 2, 0);
	await add.click();
	await expect(page.getByText(/longueur \d+ m/)).toBeVisible();
	await pan(page, 0, 1);
	await add.click();
	await pan(page, -2, 0);
	await add.click();
	await expect(page.getByText('4 points')).toBeVisible();
	await expect(page.getByText(/touchez le point 1/)).toBeVisible();

	// Annuler puis remettre le dernier point
	await page.getByRole('button', { name: 'Annuler le point' }).click();
	await expect(page.getByText('3 points')).toBeVisible();
	await add.click();

	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.exclude('.maplibregl-canvas-container')
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);

	// Fermer en touchant le point 1 → fiche quai
	await page.getByRole('button', { name: 'Point 1 : fermer le quai' }).click();
	await expect(page).toHaveURL(/\/gare\/saisie\/?\?id=.*&osm=way\/-\d+/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quai sans numéro');

	// Serveur de test : saisie possible ; numéro de la voie le long du quai
	await page.getByRole('textbox', { name: 'Ajouter un numéro de voie' }).fill('1');
	await page.getByRole('textbox', { name: 'Ajouter un numéro de voie' }).press('Enter');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);

	// Une seule saisie (le quai et son numéro), puis envoi
	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await expect(page.getByText(/Quai : voies 1 \(dessiné\)/)).toBeVisible();
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();

	const xml = uploads[0];
	const nodes = [...xml.matchAll(/<node id="(-\d+)"/g)].map((m) => m[1]);
	expect(nodes).toHaveLength(4);
	const way = xml.match(/<way id="-\d+" changeset="88">(.*?)<\/way>/)![1];
	const refs = [...way.matchAll(/<nd ref="(-\d+)"\/>/g)].map((m) => m[1]);
	expect(refs).toHaveLength(5);
	expect(refs[0]).toBe(refs[4]); // contour fermé
	expect(new Set(refs.slice(0, 4))).toEqual(new Set(nodes)); // aucun nœud partagé avec autre chose
	expect(way).toContain('<tag k="railway" v="platform"/>');
	expect(way).toContain('<tag k="public_transport" v="platform"/>');
	expect(way).toContain('<tag k="ref" v="1"/>');
	expect(xml.indexOf('<way')).toBeGreaterThan(xml.lastIndexOf('<node'));
});

test('refuse de fermer un quai dont les côtés se croisent', async ({ page }) => {
	await setup(page);
	await page.goto(`/gare/dessiner/?id=${STATION}`);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	const add = page.getByRole('button', { name: 'Ajouter un point' });
	// Nœud papillon : 1 (0,0) → 2 (2,1) → 3 (2,0) → 4 (0,1) : les côtés 1-2 et 3-4 se croisent
	await add.click();
	await pan(page, 2, 1);
	await add.click();
	await pan(page, 0, -1);
	await add.click();
	await pan(page, -2, 1);
	await add.click();
	await page.getByRole('button', { name: 'Fermer le quai', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('se croisent');
	await expect(page).toHaveURL(/\/gare\/dessiner/);
});

test('E11 : glisser au doigt un point déjà posé, annuler ce déplacement, puis fermer le quai', async ({
	page
}) => {
	const uploads = await setup(page);
	await page.goto(`/gare/dessiner/?id=${STATION}`);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	const add = page.getByRole('button', { name: 'Ajouter un point', exact: true });
	await add.click();
	await pan(page, 2, 0);
	await add.click();
	await pan(page, 0, 1);
	await add.click();
	await expect(page.getByText('3 points')).toBeVisible();

	const vertex = page.locator('[data-point="2"]');
	const where = async () => {
		const b = (await vertex.boundingBox())!;
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};
	/** Glisser au doigt (événements tactiles réels) du point 2, de (dx, dy) px. */
	async function drag(dx: number, dy: number) {
		const from = await where();
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: string, p?: { x: number; y: number }) =>
			cdp.send('Input.dispatchTouchEvent', {
				type: type as 'touchStart',
				touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : []
			});
		await touch('touchStart', from);
		for (let i = 1; i <= 10; i++)
			await touch('touchMove', { x: from.x + (dx * i) / 10, y: from.y + (dy * i) / 10 });
		await touch('touchEnd');
		await cdp.detach();
	}
	const before = await where();
	const center = await page.locator('.mapbox').getAttribute('data-center');
	await drag(-30, -50);
	await expect(page.getByText(/^Point 2 déplacé/)).toBeAttached();
	await expect(page.getByRole('button', { name: 'Annuler le déplacement' })).toBeVisible();
	await expect(page.locator('.mapbox')).toHaveAttribute('data-center', center!); // carte immobile
	await expect.poll(async () => (await where()).y).toBeLessThan(before.y - 30);
	// Annuler : le point revient à sa place ; le bouton reprend son rôle habituel
	await page.getByRole('button', { name: 'Annuler le déplacement' }).click();
	await expect(page.getByText('Déplacement annulé.')).toBeAttached();
	await expect.poll(async () => Math.round((await where()).y)).toBe(Math.round(before.y));
	await expect(page.getByRole('button', { name: 'Annuler le point' })).toBeVisible();
	await drag(-30, -50);
	await expect(page.getByText(/^Point 2 déplacé/)).toBeAttached();

	await page.getByRole('button', { name: 'Point 1 : fermer le quai' }).click();
	await expect(page).toHaveURL(/\/gare\/saisie\/?\?id=.*&osm=way\/-\d+/);
	await page.goto(`/envoi/?id=${STATION}`);
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();
	expect([...uploads[0].matchAll(/<node id="-\d+"/g)]).toHaveLength(3);
});
