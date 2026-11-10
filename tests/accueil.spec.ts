import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Collecte les erreurs de la console (dont les violations de la politique de sécurité CSP).
function watchErrors(page: Page) {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

async function expectAccessible(page: Page) {
	// axe embarque sa propre version des types Playwright : simple conversion de type.
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id} : ${v.help}`)).toEqual([]);
}

test('la présentation se déroule et la carte sécurité ne peut pas être passée', async ({
	page
}) => {
	const errors = watchErrors(page);
	await page.goto('/');
	// Étape 1 (premier lancement) : langue, pré-remplie d'après le téléphone.
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choisissez votre langue');
	await page.getByRole('button', { name: 'Suivant' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Complétez les données de votre gare'
	);
	await page.getByRole('button', { name: 'Passer' }).click();
	await expect(page.getByText('Sécurité', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Passer' })).toHaveCount(0);
	await page.getByRole('button', { name: "J'ai compris" }).click();
	await page.getByRole('button', { name: 'Commencer' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explorez les gares de France');
	await expect(page.getByRole('link', { name: 'Choisir une gare' })).toBeVisible();
	expect(errors).toEqual([]);
});

test('la politique de sécurité est présente dans la page', async ({ page }) => {
	await page.goto('/');
	const csp = await page
		.locator('meta[http-equiv="content-security-policy"]')
		.getAttribute('content');
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("object-src 'none'");
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`accessibilité (thème ${colorScheme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.goto('/');
		await expectAccessible(page); // étape « langue »
		await page.getByRole('button', { name: 'Suivant' }).click();
		await expectAccessible(page);
		await page.getByRole('button', { name: 'Passer' }).click();
		await expectAccessible(page);
		await page.goto('/a-propos/');
		await expectAccessible(page);
	});
}

test('le manifeste rend l’appli installable', async ({ page, request }) => {
	await page.goto('/');
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	const manifest = await (await request.get(href!)).json();
	expect(manifest.display).toBe('standalone');
	expect(manifest.start_url).toBe('/');
	const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
	expect(sizes).toContain('192x192');
	expect(sizes).toContain('512x512');
	for (const icon of manifest.icons) {
		expect((await request.get(icon.src)).ok()).toBe(true);
	}
});

test('l’appli s’ouvre sans réseau après une première visite', async ({ page, context }) => {
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload(); // la page est désormais contrôlée par le service worker
	await context.setOffline(true);
	await page.reload();
	// Premier lancement pas encore terminé : l'appli rouvre sur l'étape « langue ».
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choisissez votre langue');
	await page.goto('/a-propos/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('À propos de stationcomplete');
});
