import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Quai en plusieurs parties (gare synthétique « type Saint-Lazare ») : quai P coupé en 3 parties,
// dont 2 couvertes (layer=-1) ; quai Q en 2 parties aux numéros différents ; voies coupées en
// tunnel. Serveur de test simulé (aucun appel réel à OSM).
const fixture = JSON.parse(readFileSync('tests/fixtures/saint-lazare-type.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const STATION = 'n3533789791';
const DEV = 'https://master.apis.dev.openstreetmap.org';
const [P_OPEN, P_B, P_C] = fixture.parts.P as number[];
const [, Q_B] = fixture.parts.Q as number[];
type El = { type: string; id: number; lon?: number; lat?: number; nodes?: number[] };
const els = fixture.elements as El[];

/** Centre d'une partie (moyenne des sommets du contour). */
function centerOf(wayId: number): [number, number] {
	const w = els.find((e) => e.type === 'way' && e.id === wayId)!;
	const pts = w.nodes!.slice(0, -1).map((id) => els.find((e) => e.type === 'node' && e.id === id)!);
	return [
		pts.reduce((s, p) => s + p.lon!, 0) / pts.length,
		pts.reduce((s, p) => s + p.lat!, 0) / pts.length
	];
}

async function setup(page: Page) {
	await page.addInitScript((dev) => {
		localStorage.setItem('rc:server', JSON.stringify('dev'));
		localStorage.setItem('rc:clientId:dev', JSON.stringify('client-de-test'));
		localStorage.setItem('rc:user:dev', JSON.stringify({ name: 'testeur', id: 1 }));
		localStorage.setItem('rc:demo', 'true');
		localStorage.setItem(dev + 'oauth2_access_token', 'jeton-de-test');
	}, DEV);
	await page
		.context()
		.route('https://data.geopf.fr/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: tile }));
	const uploads: { create: string[]; upload: string[] } = { create: [], upload: [] };
	await page.route(`${DEV}/api/0.6/**`, async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		const p = url.pathname;
		const json = (o: unknown) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
		if (p.endsWith('/map.json')) return json({ elements: fixture.elements });
		if (p.endsWith('/ways.json')) {
			const ids = (url.searchParams.get('ways') ?? '').split(',').map(Number);
			return json({ elements: els.filter((e) => e.type === 'way' && ids.includes(e.id)) });
		}
		if (p.endsWith('/changeset/create')) {
			uploads.create.push(req.postData() ?? '');
			return route.fulfill({ body: '4242' });
		}
		if (p.endsWith('/changeset/4242/upload')) {
			uploads.upload.push(req.postData() ?? '');
			return route.fulfill({
				contentType: 'text/xml',
				body: `<diffResult>${[P_OPEN, P_B, P_C].map((id) => `<way old_id="${id}" new_id="${id}" new_version="4"/>`).join('')}</diffResult>`
			});
		}
		if (p.endsWith('/close')) return route.fulfill({ body: '' });
		if (p.endsWith('/changeset/4242.json'))
			return json({ changeset: { id: 4242, open: true, changes_count: 0 } });
		return route.fulfill({ status: 404, body: 'inconnu' });
	});
	return uploads;
}

async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

/** Ouvre E5 centrée sur une partie de quai, au zoom 19,5 (une partie couverte fait ~700 px). */
async function openMapOn(page: Page, wayId: number) {
	const [lon, lat] = centerOf(wayId);
	await page.goto(`/gare/carte/?id=${STATION}&z=19.5&c=${lon.toFixed(7)},${lat.toFixed(7)}`);
	await expect(page.locator('.map[data-zoom]')).toHaveAttribute('data-zoom', '19.50');
}

/** Touche la carte en son centre (là où est la partie visée). */
async function tapCenter(page: Page) {
	const box = (await page.locator('.map').boundingBox())!;
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('quai en 3 parties : une étiquette, toucher la partie couverte sélectionne le quai entier', async ({
	page
}) => {
	await setup(page);
	await openMapOn(page, P_B);
	// 5 parties de quai, 2 quais : 2 étiquettes seulement.
	await expect(page.locator('.rc-badge.quai')).toHaveCount(2);
	await expect(page.locator('.rc-badge.quai', { hasText: '?' })).toHaveCount(1);

	await tapCenter(page);
	const sheet = page.getByRole('region', { name: 'Objet sélectionné' });
	await expect(
		sheet.getByRole('heading', { name: 'Quai sans numéro — en 3 parties, dont 2 couvertes' })
	).toBeVisible();
	// L'étiquette du quai (posée sur la partie à l'air libre) est celle de l'objet sélectionné.
	await expect(page.locator('.rc-badge.quai', { hasText: '?' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expectAccessible(page);

	// Forme : partie par partie.
	await sheet.getByRole('button', { name: 'Modifier la forme' }).click();
	const menu = page.locator('#part-menu');
	await expect(menu.getByText('Quelle partie du quai ?')).toBeVisible();
	await expect(menu.getByRole('link')).toHaveCount(3);
	await expect(
		menu.getByRole('link', { name: /Partie à l’air libre \(120\s?m\)/ })
	).toHaveAttribute('href', new RegExp(`osm=way/${P_OPEN}`));
	await expect(menu.getByRole('link', { name: /Partie couverte \(40\s?m\)/ })).toHaveAttribute(
		'href',
		new RegExp(`osm=way/${P_C}`)
	);
	await expectAccessible(page);

	// Suppression : on choisit la partie, la confirmation le dit.
	await sheet.getByRole('button', { name: 'Plus d’actions' }).click();
	await sheet.getByRole('button', { name: 'Supprimer ce quai…' }).click();
	await menu.getByRole('button', { name: /Partie couverte \(40\s?m\)/ }).click();
	await expect(sheet.getByText(/Seule cette partie sera supprimée/)).toBeVisible();
	await sheet.getByRole('button', { name: 'Annuler' }).click();
});

test('numéro saisi une fois, écrit sur les 3 parties dans le même envoi', async ({ page }) => {
	const calls = await setup(page);
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${P_B}`);
	await expect(
		page.getByText('Ce quai est en 3 parties, dont 2 couvertes dans OpenStreetMap')
	).toBeVisible();
	await page.getByRole('textbox', { name: 'Ajouter un numéro de voie' }).fill('23');
	await page.getByRole('textbox', { name: 'Ajouter un numéro de voie' }).press('Enter');
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);
	// Une seule étiquette, avec le numéro, marquée « modifié par vous ».
	await expect(page.locator('.rc-badge.quai.edited', { hasText: '23' })).toHaveCount(1);

	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await expect(page.getByText('Quai : voies 23 (3 parties)')).toBeVisible();
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();

	expect(calls.create[0]).toContain(
		'Quai voies 23 (3 parties) : numéro renseigné sur chaque partie'
	);
	const body = calls.upload[0];
	const modified = [...body.matchAll(/<way id="(\d+)" version="3" changeset="4242">(.*?)<\/way>/g)];
	expect(modified.map((m) => Number(m[1]))).toEqual([P_OPEN, P_B, P_C]);
	for (const m of modified) expect(m[2]).toContain('<tag k="ref" v="23"/>');
	expect(body.match(/<modify>/g)).toHaveLength(1);
});

test('parties aux numéros différents : quai signalé incohérent, sans correction', async ({
	page
}) => {
	await setup(page);
	await page.goto(`/gare/?id=${STATION}`);
	// Jauge : 2 quais (pas 5), dont 1 numéroté.
	await expect(page.locator('.gauge.quai .g-num')).toHaveText('1/2');
	await expect(page.getByText('Les parties d’un même quai n’ont pas le même numéro')).toBeVisible();

	// La carte, centrée sur la partie couverte du quai Q, la sélectionne avec le quai entier.
	await page.goto(`/gare/carte/?id=${STATION}&focus=way/${Q_B}`);
	const sheet = page.getByRole('region', { name: 'Objet sélectionné' });
	await expect(sheet.getByRole('heading', { name: /en 2 parties, dont 1 couverte/ })).toBeVisible();
	await expect(
		sheet.getByText('Les parties de ce quai n’ont pas le même numéro : vérifiez sur place')
	).toBeVisible();
	await expectAccessible(page);
});
