import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// E3 « Choisir une gare » (carte Reprendre, recherche, favorites) et étape « langue » du premier
// lancement (E1). API OSM simulée avec les données réelles d'Ambérieu-en-Bugey.
const fixture = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const AMBERIEU = 'w67074448';
// Position fictive à 2 km d'Ambérieu-en-Bugey.
const NEAR_AMBERIEU = { latitude: 45.97, longitude: 5.355 };

async function mockOsm(page: Page) {
	await page.route('https://api.openstreetmap.org/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ version: '0.6', elements: fixture.elements })
		})
	);
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

/** Présentation déjà vue (utilisateur existant). */
const onboarded = (page: Page) =>
	page.addInitScript(() => localStorage.setItem('rc:intro', 'true'));

test.describe('premier lancement : langue', () => {
	test('la langue proposée est celle du téléphone ; choisir l’anglais traduit l’appli', async ({
		page
	}) => {
		const errors = watchErrors(page);
		await page.goto('/');
		const h1 = page.getByRole('heading', { level: 1 });
		await expect(h1).toHaveText('Choisissez votre langue');
		// Un seul pays activé : il est affiché, sans choix.
		await expect(page.getByText('Gares de France ; d’autres pays suivront.')).toBeVisible();
		await expect(page.getByRole('radio', { name: /Français/ })).toBeChecked();
		await expect(page.getByText('Langue du téléphone')).toBeVisible();
		await expectAccessible(page);
		// Choix refait tant que la page n'est pas hydratée.
		await expect(async () => {
			await page.getByRole('radio', { name: 'English' }).check();
			await expect(h1).toHaveText('Choose your language', { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		expect(await page.evaluate(() => localStorage.getItem('rc:lang'))).toBe('"en"');
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(h1).toHaveText('Complete the data of your station');
		// La suite (sécurité comprise) est en anglais, et le reste après rechargement.
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		expect(errors).toEqual([]);
	});

	test('un utilisateur existant ne revoit pas l’accueil', async ({ page }) => {
		await onboarded(page);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'Explorez les gares de France'
		);
		await expect(page.getByText('Choisissez votre langue')).toHaveCount(0);
	});

	test('préférence « rc:onboarded » : pas d’accueil non plus', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('rc:onboarded', 'true'));
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'Explorez les gares de France'
		);
	});
});

test.describe('choisir une gare (E3)', () => {
	test.use({ geolocation: NEAR_AMBERIEU, permissions: ['geolocation'] });

	test('« amb » près d’Ambérieu : Ambérieu-en-Bugey en premier', async ({ page }) => {
		const errors = watchErrors(page);
		await onboarded(page);
		await page.goto('/gares/');
		// Position déjà autorisée : gares proches sans rien demander.
		await expect(page.getByRole('heading', { name: 'Autour de moi' })).toBeVisible();
		const search = page.getByRole('searchbox', { name: 'Rechercher une gare' });
		await expect(async () => {
			await search.fill('amb');
			await expect(page.getByText('les plus proches d’abord')).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		const first = page.locator('.fiche a').first();
		await expect(first).toContainText('Ambérieu-en-Bugey');
		await expect(first).toContainText('Ain (01)');
		await expect(page.locator('.fiche a').nth(1)).toContainText('Ambronay-Priay');
		// Accents et « St » pour « Saint »
		await search.fill('st rambert');
		await expect(page.locator('.fiche a').first()).toContainText('Saint-Rambert-en-Bugey');
		expect(errors).toEqual([]);
	});

	test('carte « Reprendre » avec une saisie en attente, puis prochaine tâche', async ({ page }) => {
		const errors = watchErrors(page);
		await mockOsm(page);
		await onboarded(page);
		// Gare ouverte une fois (données en cache sur le téléphone)…
		await page.goto(`/gare/?id=${AMBERIEU}`);
		await expect(page.getByLabel('Complétude de la gare')).toContainText('4/4');
		// … il y a plus de 24 h, mais avec une saisie en attente d'envoi.
		await page.evaluate(async (station) => {
			localStorage.setItem(
				'rc:lastOpened',
				JSON.stringify({ id: station, at: Date.now() - 3 * 86_400_000 })
			);
			const db = await new Promise<IDBDatabase>((ok, ko) => {
				const r = indexedDB.open('stationcomplete', 2);
				r.onsuccess = () => ok(r.result);
				r.onerror = () => ko(r.error);
			});
			await new Promise((ok, ko) => {
				const tx = db.transaction('edits', 'readwrite');
				tx.objectStore('edits').put({
					id: 'e2e-1',
					station,
					createdAt: Date.now(),
					server: 'prod',
					country: 'fr',
					kind: 'tags',
					target: 'way/1357219270',
					tags: { check_date: '2026-11-07' },
					summary: 'Quai A',
					family: 'quai'
				});
				tx.oncomplete = ok;
				tx.onerror = () => ko(tx.error);
			});
			db.close();
		}, AMBERIEU);
		await page.goto('/gares/');
		const card = page.getByRole('region', { name: 'Ambérieu-en-Bugey' });
		await expect(card).toContainText('Reprendre');
		await expect(card).toContainText('1 saisie en attente d’envoi');
		await expect(card).toContainText('Quais numérotés');
		await expect(card).toContainText('4/4');
		// Prochaine tâche : la première quête de la gare (même ordre que le tableau de bord).
		const next = card.getByRole('link', { name: /^Continuer : Deux voies portent le numéro 2/ });
		await expect(next).toBeVisible();
		await expectAccessible(page);
		await next.click();
		await expect(page).toHaveURL(/\/gare\/carte\/?\?id=w67074448&focus=way%2F|focus=way\//);
		expect(errors).toEqual([]);
	});

	test('favorite ajoutée puis retrouvée', async ({ page }) => {
		await onboarded(page);
		await page.goto('/gares/');
		const search = page.getByRole('searchbox', { name: 'Rechercher une gare' });
		await expect(async () => {
			await search.fill('ambronay');
			await expect(page.locator('.fiche').first()).toContainText('Ambronay-Priay', {
				timeout: 1000
			});
		}).toPass({ timeout: 10_000 });
		const star = page.getByRole('button', { name: 'Favorite : Ambronay-Priay' }).first();
		await expect(star).toHaveAttribute('aria-pressed', 'false');
		await star.click();
		await expect(star).toHaveAttribute('aria-pressed', 'true');
		await page.reload();
		const favs = page.getByRole('heading', { name: 'Favorites' });
		await expect(favs).toBeVisible();
		await expect(
			page.locator('h2:has-text("Favorites") + ul .fiche', { hasText: 'Ambronay-Priay' })
		).toHaveCount(1);
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`accessibilité de E3 (thème ${colorScheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme });
			await page.addInitScript(() => {
				localStorage.setItem('rc:intro', 'true');
				localStorage.setItem('rc:favorites', JSON.stringify(['n2196757400']));
				localStorage.setItem('rc:recent', JSON.stringify(['w67074448', 'n7034430300']));
			});
			await page.goto('/gares/');
			await expect(page.getByRole('heading', { name: 'Autour de moi' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('searchbox', { name: 'Rechercher une gare' }).fill('amb');
			await expect(page.locator('.fiche').first()).toContainText('Ambérieu-en-Bugey');
			await expectAccessible(page);
		});
	}
});
