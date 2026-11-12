import type { Page } from '@playwright/test';

/**
 * État officiel des ascenseurs (lot S1, D4 bis) : la page de la gare (E4) interroge la source
 * open data de l'exploitant. Les parcours qui ne testent pas cette fonction la simulent « gare non
 * couverte » (rien d'affiché), pour ne jamais joindre la vraie source pendant les tests.
 * Le parcours de la fonction elle-même : etat-officiel.spec.ts.
 */
export async function sansEtatOfficiel(page: Page) {
	await page.context().route('https://ressources.data.sncf.com/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: '{"total_count":0,"results":[]}'
		})
	);
}
