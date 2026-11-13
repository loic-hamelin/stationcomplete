import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Mode souterrain (13 novembre 2026) : sur la vraie carte (serveur simulé), « sur place » vérifié
// à l'entrée par le GPS, ou déclaré sur l'honneur, puis valable 2 h pour cette gare, sans GPS ni
// réseau ; saisie hors-ligne et envoi au retour du réseau.
const fixture = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const STATION = 'w67074448';
const WAY = 983664438;
const API = 'https://api.openstreetmap.org';
/** Centre de la gare d'Ambérieu-en-Bugey (dans son emprise). */
const AMBERIEU = { latitude: 45.95398, longitude: 5.34234, accuracy: 10 };
type El = { type: string; id: number; version?: number };
const freshWay = (fixture.elements as El[]).find((e) => e.type === 'way' && e.id === WAY)!;

/** Vraie carte, compte « Pilote » autorisé ; API OSM et photos simulées. */
async function setup(page: Page, opts: { lang?: string } = {}) {
	await page.addInitScript((lang) => {
		localStorage.setItem('rc:server', JSON.stringify('prod'));
		localStorage.setItem('rc:user:prod', JSON.stringify({ name: 'Pilote', id: 2 }));
		localStorage.setItem('https://www.openstreetmap.orgoauth2_access_token', 'jeton-de-test');
		if (lang) localStorage.setItem('rc:lang', JSON.stringify(lang));
	}, opts.lang);
	const ctx = page.context();
	await ctx.route('**/config.json', (r) =>
		r.fulfill({ contentType: 'application/json', body: JSON.stringify({ pilotUsers: ['Pilote'] }) })
	);
	await ctx.route('https://data.geopf.fr/**', (r) =>
		r.fulfill({
			contentType: 'image/jpeg',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: tile
		})
	);
	const calls: { method: string; path: string; body: string }[] = [];
	await page.route(`${API}/api/0.6/**`, (route) => {
		const req = route.request();
		const p = new URL(req.url()).pathname;
		calls.push({ method: req.method(), path: p, body: req.postData() ?? '' });
		const json = (o: unknown) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
		if (p.endsWith('/map.json')) return json({ elements: fixture.elements });
		if (p.endsWith('/ways.json')) return json({ elements: [freshWay] });
		if (p.endsWith('/changeset/create')) return route.fulfill({ body: '88' });
		if (p.endsWith('/changeset/88/upload'))
			return route.fulfill({
				contentType: 'text/xml',
				body: `<diffResult><way old_id="${WAY}" new_id="${WAY}" new_version="${(freshWay.version ?? 1) + 1}"/></diffResult>`
			});
		if (p.endsWith('/close')) return route.fulfill({ body: '' });
		return route.fulfill({ status: 404, body: '' });
	});
	return calls;
}

async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

/** Saisies enregistrées sur le téléphone (IndexedDB). */
const storedEdits = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<{ onsite?: string; station: string }[]>((done) => {
				const r = indexedDB.open('stationcomplete');
				r.onsuccess = () => {
					const q = r.result.transaction('edits').objectStore('edits').getAll();
					q.onsuccess = () => done(q.result);
				};
			})
	);

async function noGps(context: BrowserContext) {
	// Aucune autorisation : le navigateur refuse la position (comme un GPS muet sous terre).
	await context.clearPermissions();
}

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('GPS vérifié à l’entrée, saisie hors-ligne sous terre, envoi au retour du réseau', async ({
	page,
	context
}) => {
	const calls = await setup(page);
	await context.grantPermissions(['geolocation']);
	await context.setGeolocation(AMBERIEU);
	await page.goto(`/gare/?id=${STATION}`);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.getByRole('button', { name: 'Je vais dans une gare souterraine' }).click();
	// La gare est téléchargée, puis la position vérifiée : le mode est actif pour 2 heures.
	await expect(page.getByText('Disponible hors-ligne')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/Mode souterrain actif pour cette gare jusqu’à/)).toBeVisible();
	const band = page.getByRole('region', { name: 'Mode souterrain' });
	await expect(band).toContainText('Ambérieu-en-Bugey');
	await expect(band).toContainText('encore 2 h 00');
	await expectAccessible(page);

	// Sous terre : ni réseau ni GPS.
	await context.setOffline(true);
	await noGps(context);
	await page.goto(`/gare/?id=${STATION}`);
	await expect(page.getByRole('heading', { name: 'Ambérieu-en-Bugey' })).toBeVisible();
	await expect(page.getByText(/Mode souterrain actif/)).toBeVisible();
	await page.goto(`/gare/carte/?id=${STATION}`);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	await expect(page.getByRole('button', { name: /Sur place/ })).toBeVisible();
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await expect(band).toBeVisible();
	await page.getByRole('textbox', { name: 'Numéro de la voie' }).fill('13');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);
	expect((await storedEdits(page)).map((e) => e.onsite)).toEqual(['gps-entree']);

	// Rechargement sans réseau : le mode tient toujours.
	await page.reload();
	await expect(band).toContainText('Ambérieu-en-Bugey');

	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Envoyer dès le retour du réseau' }).click();
	await expect(page.getByText('En attente du réseau : l’envoi partira tout seul.')).toBeVisible();
	expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);

	// Retour en surface : l'envoi part tout seul.
	await context.setOffline(false);
	await expect(page.getByText(/1 modification envoyée automatiquement/)).toBeVisible({
		timeout: 15_000
	});
	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!;
	expect(create.body).toContain('k="source" v="survey"');
	// La manière dont « sur place » a été établi reste sur le téléphone.
	const upload = calls.find((c) => c.path.endsWith('/upload'))!;
	expect(upload.body + create.body).not.toMatch(/gps|onsite|souterrain|underground/i);
});

test('sans GPS : déclaration sur l’honneur, pour cette gare seulement', async ({
	page,
	context
}) => {
	await setup(page);
	await noGps(context);
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	const input = page.getByRole('textbox', { name: 'Numéro de la voie' });
	await expect(input).toBeDisabled();
	await page.getByRole('button', { name: 'Je vais dans une gare souterraine' }).click();
	await expect(page.getByText(/Le GPS ne répond pas/)).toBeVisible({ timeout: 30_000 });
	const activate = page.getByRole('button', { name: 'Activer le mode souterrain' });
	await expect(activate).toBeDisabled();
	await expectAccessible(page);
	await page.getByRole('checkbox', { name: /Je déclare sur l’honneur/ }).check();
	await activate.click();
	await expect(input).toBeEnabled();
	await input.fill('13');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);
	expect((await storedEdits(page)).map((e) => e.onsite)).toEqual(['declaration']);
	// Saisie sur déclaration : relecture demandée d'office sur E8 (QA-3).
	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByRole('checkbox', { name: 'Je souhaite une relecture' })).toBeChecked();

	// Une autre gare reste « à distance ».
	await page.goto('/gare/?id=n439213437');
	await expect(
		page.getByRole('button', { name: 'Je vais dans une gare souterraine' })
	).toBeVisible();

	// « Arrêter » : le mode cesse aussitôt.
	await page.getByRole('region', { name: 'Mode souterrain' }).getByRole('button').click();
	await expect(page.getByRole('region', { name: 'Mode souterrain' })).toHaveCount(0);
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await expect(input).toBeDisabled();
});

test('GPS précis hors de la gare : pas de déclaration, il faut s’approcher', async ({
	page,
	context
}) => {
	await setup(page);
	await context.grantPermissions(['geolocation']);
	await context.setGeolocation({ latitude: 45.9, longitude: 5.2, accuracy: 10 });
	await page.goto(`/gare/?id=${STATION}`);
	await page.getByRole('button', { name: 'Je vais dans une gare souterraine' }).click();
	await expect(page.getByText(/Votre position est hors de la gare/)).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('checkbox')).toHaveCount(0);
	await context.setGeolocation(AMBERIEU);
	await page.getByRole('button', { name: 'Réessayer' }).click();
	await expect(page.getByText(/Mode souterrain actif/)).toBeVisible();
});

test('le mode expire tout seul au bout de 2 heures', async ({ page, context }) => {
	await page.clock.install();
	await setup(page);
	await noGps(context);
	await page.goto(`/gare/saisie/?id=${STATION}&osm=way/${WAY}`);
	await page.getByRole('button', { name: 'Je vais dans une gare souterraine' }).click();
	await page.getByRole('checkbox', { name: /Je déclare sur l’honneur/ }).check();
	await page.getByRole('button', { name: 'Activer le mode souterrain' }).click();
	const band = page.getByRole('region', { name: 'Mode souterrain' });
	await expect(band).toContainText('encore 2 h 00');
	await page.clock.fastForward('01:30:00');
	await expect(band).toContainText('encore 30 min');
	await expect(page.getByRole('textbox', { name: 'Numéro de la voie' })).toBeEnabled();
	await page.clock.fastForward('00:30:30');
	await expect(band).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Numéro de la voie' })).toBeDisabled();
	await expect(band).toHaveCount(0);
});

test('en allemand : Untergrundmodus per Ehrenerklärung', async ({ page, context }) => {
	await setup(page, { lang: 'de' });
	await noGps(context);
	await page.goto(`/gare/?id=${STATION}`);
	await page.getByRole('button', { name: 'Ich gehe in einen unterirdischen Bahnhof' }).click();
	await expect(page.getByText(/Das GPS antwortet nicht/)).toBeVisible({ timeout: 30_000 });
	await page.getByRole('checkbox', { name: /Ich erkläre ehrenwörtlich/ }).check();
	await page.getByRole('button', { name: 'Untergrundmodus einschalten' }).click();
	const band = page.getByRole('region', { name: 'Untergrundmodus' });
	await expect(band).toContainText('noch 2 h 00');
	await expectAccessible(page);
	await band.getByRole('button', { name: 'Untergrundmodus beenden' }).click();
	await expect(band).toHaveCount(0);
});
