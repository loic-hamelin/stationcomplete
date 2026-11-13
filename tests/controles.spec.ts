import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// QA-2 (contrôles automatiques avant envoi) et QA-3 (demande de relecture) sur l'écran d'envoi
// E8, gare d'Ambérieu-en-Bugey, serveur de test simulé (aucun appel réel à OSM).
const AMB = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const DEV = 'https://master.apis.dev.openstreetmap.org';
const STATION = 'w67074448';
const TRACK = 983664438; // voie « 13Mag »
const QUAI_A = 1357219270;
const TICKET = 12617876405; // distributeur de billets isolé

type El = {
	type: 'node' | 'way' | 'relation';
	id: number;
	version?: number;
	nodes?: number[];
	members?: { type: string; ref: number; role: string }[];
};
const elements = AMB.elements as El[];

/** Serveur de test simulé (lecture, relectures avant envoi, changeset) ; journal des appels. */
async function setup(page: Page) {
	await page.addInitScript((dev) => {
		localStorage.setItem('rc:server', JSON.stringify('dev'));
		localStorage.setItem('rc:clientId:dev', JSON.stringify('client-de-test'));
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
	const calls: { method: string; path: string; body: string }[] = [];
	const byId = (type: string, id: number) => elements.find((e) => e.type === type && e.id === id);
	await page.route(`${DEV}/api/0.6/**`, async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		const p = url.pathname;
		calls.push({ method: req.method(), path: p + url.search, body: req.postData() ?? '' });
		const json = (list: unknown[]) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: list }) });
		if (p.endsWith('/map.json')) return json(elements);
		const many = p.match(/\/(nodes|ways|relations)\.json$/);
		if (many) {
			const ids = (url.searchParams.get(many[1]) ?? '').split(',').map(Number);
			return json(ids.map((id) => byId(many[1].slice(0, -1), id)).filter(Boolean));
		}
		const of = p.match(/\/node\/(\d+)\/(ways|relations)\.json$/);
		if (of) {
			const id = Number(of[1]);
			return json(
				elements.filter((e) =>
					of[2] === 'ways'
						? e.type === 'way' && e.nodes!.includes(id)
						: e.type === 'relation' && e.members!.some((m) => m.type === 'node' && m.ref === id)
				)
			);
		}
		if (p.endsWith('/changeset/create')) return route.fulfill({ body: '1234' });
		if (p.endsWith('/changeset/1234/upload'))
			return route.fulfill({ contentType: 'text/xml', body: '<diffResult version="0.6"/>' });
		if (p.endsWith('/close')) return route.fulfill({ body: '' });
		return route.fulfill({ status: 404, body: 'inconnu' });
	});
	return calls;
}

/** Range des saisies sur le téléphone (IndexedDB), comme si elles avaient été faites dans l'appli. */
async function storeEdits(page: Page, edits: Record<string, unknown>[]) {
	await page.goto(`/gare/?id=${STATION}`);
	await expect(page.getByRole('heading', { name: 'Ambérieu-en-Bugey' })).toBeVisible();
	await page.evaluate(
		(list) =>
			new Promise<void>((done) => {
				const r = indexedDB.open('stationcomplete');
				r.onsuccess = () => {
					const tx = r.result.transaction('edits', 'readwrite');
					for (const e of list) tx.objectStore('edits').put(e);
					tx.oncomplete = () => done();
				};
			}),
		edits.map((e, i) => ({
			station: STATION,
			server: 'dev',
			country: 'fr',
			createdAt: 1000 + i,
			...e
		}))
	);
}

async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('E8 : une erreur bloque sa saisie, un avertissement part après « J’ai vérifié »', async ({
	page
}) => {
	const calls = await setup(page);
	await storeEdits(page, [
		{
			id: 'err',
			kind: 'tags',
			target: `way/${TRACK}`,
			tags: { 'railway:track_ref': '1 ; 2' },
			summary: 'Voie 1 ; 2',
			family: 'voie'
		},
		{
			id: 'warn',
			kind: 'tags',
			target: `way/${QUAI_A}`,
			tags: { height: '1.8' },
			summary: 'Quai A : hauteur 1,8 m',
			family: 'quai'
		}
	]);
	await page.goto(`/envoi/?id=${STATION}`);
	await expect(page.getByText('Prêtes à partir (2)')).toBeVisible();
	const err = page.locator('.issues > li').filter({ hasText: 'Erreur :' });
	await expect(err).toContainText('Numéro mal écrit pour railway:track_ref');
	await expect(err.getByRole('link', { name: 'Corriger' })).toHaveAttribute(
		'href',
		new RegExp(`/gare/saisie\\?id=${STATION}&osm=way/${TRACK}`)
	);
	const warn = page.locator('.issues > li').filter({ hasText: 'À vérifier :' });
	await expect(warn).toContainText('Hauteur inhabituelle : 1,80 m');
	await expect(
		page.getByText(/1 saisie ne partira pas tant qu’elle n’est pas corrigée/)
	).toBeVisible();
	// Rien ne peut partir : l'erreur bloque, l'avertissement n'est pas encore vérifié.
	await expect(page.getByRole('button', { name: /^Envoyer/ })).toHaveCount(0);
	await expect(
		page.getByRole('status').filter({ hasText: 'aucune saisie ne peut partir' })
	).toBeVisible();
	await expectAccessible(page);

	await warn.getByRole('checkbox', { name: 'J’ai vérifié' }).check();
	// Avertissement vérifié : relecture demandée d'office (modifiable).
	await expect(page.getByRole('checkbox', { name: 'Je souhaite une relecture' })).toBeChecked();
	await expect(page.getByText(/Cochée d’office/)).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();
	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!.body;
	expect(create).toContain('<tag k="review_requested" v="yes"/>');
	const upload = calls.find((c) => c.path.endsWith('/upload'))!.body;
	expect(upload).toContain('<tag k="height" v="1.8"/>');
	expect(upload).not.toContain(`way id="${TRACK}"`);
	// La saisie fautive reste sur le téléphone, à corriger.
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await expect(page.locator('.issues > li').filter({ hasText: 'Erreur :' })).toBeVisible();
});

test('E8 : suppression → relecture cochée d’office, review_requested=yes dans le changeset', async ({
	page
}) => {
	const calls = await setup(page);
	await storeEdits(page, [
		{
			id: 'del',
			kind: 'pointdelete',
			target: `node/${TICKET}`,
			version: 3,
			reason: 'duplicate',
			label: 'Distributeur de billets',
			summary: 'Distributeur de billets supprimé (en double)'
		}
	]);
	await page.goto(`/envoi/?id=${STATION}`);
	const box = page.getByRole('checkbox', { name: 'Je souhaite une relecture' });
	await expect(box).toBeChecked();
	await expect(
		page.getByText(
			'Des contributeurs expérimentés pourront relire ce groupe de modifications sur OSMCha.'
		)
	).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();
	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!.body;
	expect(create).toContain('<tag k="review_requested" v="yes"/>');
	const upload = calls.find((c) => c.path.endsWith('/upload'))!.body;
	expect(upload).toMatch(new RegExp(`<delete><node id="${TICKET}" version="3"`));
});

test('E8 : simple numéro → relecture décochée ; cochée à la main, elle part quand même', async ({
	page
}) => {
	const calls = await setup(page);
	await storeEdits(page, [
		{
			id: 'ok',
			kind: 'tags',
			target: `way/${TRACK}`,
			tags: { 'railway:track_ref': '13' },
			summary: 'Voie 13',
			family: 'voie'
		}
	]);
	await page.goto(`/envoi/?id=${STATION}`);
	const box = page.getByRole('checkbox', { name: 'Je souhaite une relecture' });
	await expect(box).not.toBeChecked();
	await expect(page.getByText(/Cochée d’office/)).toHaveCount(0);
	await expect(page.getByText(/Erreur :|À vérifier :/)).toHaveCount(0);
	await box.check();
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();
	expect(calls.find((c) => c.path.endsWith('/changeset/create'))!.body).toContain(
		'review_requested'
	);
});

test('E8 en allemand : Fehler und „Zu prüfen“', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('rc:lang', JSON.stringify('de')));
	await setup(page);
	await page.goto(`/gare/?id=${STATION}`);
	await storeEdits(page, [
		{
			id: 'warn',
			kind: 'tags',
			target: `way/${QUAI_A}`,
			tags: { height: '1.8' },
			summary: 'Bahnsteig A',
			family: 'quai'
		}
	]);
	await page.goto(`/envoi/?id=${STATION}`);
	const warn = page.locator('.issues > li').filter({ hasText: 'Zu prüfen:' });
	await expect(warn).toContainText('Ungewöhnliche Höhe');
	await warn.getByRole('checkbox', { name: 'Ich habe es geprüft' }).check();
	await expect(page.getByRole('checkbox', { name: 'Ich wünsche eine Überprüfung' })).toBeChecked();
	await expectAccessible(page);
});
