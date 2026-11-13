import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sansEtatOfficiel } from './etat-officiel-simule';

// Lot « Équipements » : informations utiles aux voyageurs, relevées sur place (mode
// démonstration) et envoyées sur le serveur de test simulé (aucun appel réel à OSM).
// Étape 1 : caractéristiques des quais (hauteur, écrans, abri, bandes podotactiles, bancs).
const AMB = JSON.parse(readFileSync('tests/fixtures/amberieu-en-bugey.json', 'utf8'));
const SL = JSON.parse(readFileSync('tests/fixtures/saint-lazare-type.json', 'utf8'));
const tile = readFileSync('tests/fixtures/tuile-grise.jpg');
const DEV = 'https://master.apis.dev.openstreetmap.org';
const AMB_ID = 'w67074448';
const SL_ID = 'n3533789791';
const QUAI_A = 1357219270; // Ambérieu, « Voie A » : hauteur 0,55 (virgule), écrans, bancs ; abri ?
const [P_OPEN, P_B, P_C] = SL.parts.P as number[];

type El = {
	type: 'node' | 'way' | 'relation';
	id: number;
	version?: number;
	lat?: number;
	lon?: number;
	nodes?: number[];
	members?: { type: string; ref: number; role: string }[];
	tags?: Record<string, string>;
};

/** Serveur de test simulé (lecture, relectures avant envoi, changeset) ; journal des appels. */
async function setup(page: Page, elements: El[], opts: { lang?: string } = {}) {
	await page.addInitScript(
		([dev, lang]) => {
			localStorage.setItem('rc:server', JSON.stringify('dev'));
			localStorage.setItem('rc:clientId:dev', JSON.stringify('client-de-test'));
			localStorage.setItem('rc:user:dev', JSON.stringify({ name: 'testeur', id: 1 }));
			localStorage.setItem('rc:demo', 'true');
			localStorage.setItem(dev + 'oauth2_access_token', 'jeton-de-test');
			if (lang) localStorage.setItem('rc:lang', JSON.stringify(lang));
		},
		[DEV, opts.lang ?? ''] as const
	);
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
		const full = p.match(/\/way\/(\d+)\/full\.json$/);
		if (full) {
			const w = byId('way', Number(full[1]));
			if (!w) return route.fulfill({ status: 404, body: '' });
			return json([...w.nodes!.map((id) => byId('node', id)), w]);
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

async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({
		page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']
	})
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.exclude('.maplibregl-canvas-container')
		.analyze();
	expect(
		violations.map(
			(v) => `${v.id} : ${v.help} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
		)
	).toEqual([]);
}

/** Groupe « Oui / Non / Je ne sais pas » d'une caractéristique (fieldset nommé par sa légende). */
const group = (page: Page, name: string | RegExp) => page.getByRole('group', { name });

test.beforeEach(({ page }) => sansEtatOfficiel(page));

test('quai en 3 parties : équipements saisis une fois, envoyés sur chaque partie (abri à l’air libre seulement)', async ({
	page
}) => {
	const calls = await setup(page, SL.elements as El[]);

	// E4 : 4e jauge et quête « équipements à relever ».
	await page.goto(`/gare/?id=${SL_ID}`);
	await expect(page.locator('.gauge.equip .g-num')).toHaveText('0/2');
	await expect(page.getByRole('link', { name: /2 quais : équipements à relever/ })).toBeVisible();
	// Les trois jauges existantes ne changent pas.
	await expect(page.locator('.gauge.quai .g-num')).toHaveText('1/2');

	await page.goto(`/gare/saisie/?id=${SL_ID}&osm=way/${P_B}`);
	await expect(page.getByRole('heading', { name: 'Équipements du quai' })).toBeVisible();
	// Rien de connu : « Je ne sais pas » partout.
	await expect(
		group(page, 'Hauteur du quai au-dessus du rail').getByRole('button', { name: 'Je ne sais pas' })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByText('Parties à l’air libre seulement')).toBeVisible();
	await group(page, 'Hauteur du quai au-dessus du rail')
		.getByRole('button', { name: /0,92\s?m/ })
		.click();
	await group(page, 'Abri pour attendre').getByRole('button', { name: 'Oui' }).click();
	await group(page, 'Bancs').getByRole('button', { name: 'Non' }).click();
	await expect(group(page, 'Bancs').getByRole('button', { name: 'Non' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expectAccessible(page);
	// Aucun numéro : on enregistre les équipements seuls.
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);

	await page.goto(`/envoi/?id=${SL_ID}`);
	await expect(page.getByText('Prêtes à partir (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();

	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!;
	expect(create.body).toContain('équipements des quais');
	expect(create.body).not.toContain('numéros de quais');
	const body = calls.find((c) => c.path.endsWith('/upload'))!.body;
	expect(body.match(/<modify>/g)).toHaveLength(1);
	const ways = Object.fromEntries(
		[...body.matchAll(/<way id="(\d+)" version="\d+" changeset="1234">(.*?)<\/way>/g)].map((m) => [
			Number(m[1]),
			m[2]
		])
	);
	expect(Object.keys(ways).map(Number).sort()).toEqual([P_OPEN, P_B, P_C].sort());
	for (const id of [P_OPEN, P_B, P_C]) {
		expect(ways[id]).toContain('<tag k="height" v="0.92"/>');
		expect(ways[id]).toContain('<tag k="bench" v="no"/>');
		expect(ways[id]).toMatch(/<tag k="check_date" v="\d{4}-\d\d-\d\d"\/>/);
	}
	expect(ways[P_OPEN]).toContain('<tag k="shelter" v="yes"/>');
	expect(ways[P_B]).not.toContain('k="shelter"');
	expect(ways[P_C]).not.toContain('k="shelter"');
	// « Je ne sais pas » n'écrit rien.
	expect(body).not.toContain('passenger_information_display');
	expect(body).not.toContain('tactile_paving');
});

test('en allemand : équipements préremplis, hauteur contrôlée, un seul envoi avec les numéros', async ({
	page
}) => {
	const calls = await setup(page, AMB.elements as El[], { lang: 'de' });
	await page.goto(`/gare/saisie/?id=${AMB_ID}&osm=way/${QUAI_A}`);
	await expect(page.getByRole('heading', { name: 'Ausstattung des Bahnsteigs' })).toBeVisible();
	// Valeurs déjà dans OSM : hauteur « 0,55 » (écrite avec une virgule), bandes et bancs ;
	// departures_board=yes ne dit rien des écrans ; l'abri n'est pas renseigné.
	const height = group(page, 'Bahnsteighöhe über Schienenoberkante');
	await expect(height.getByRole('button', { name: /0,55\s?m/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(
		group(page, 'Sitzbänke').getByRole('button', { name: 'Ja', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	const display = group(page, /Zuganzeiger/);
	await expect(display.getByRole('button', { name: 'Weiß nicht' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await display.getByRole('button', { name: 'Ja', exact: true }).click();
	const shelter = group(page, 'Unterstand zum Warten');
	await expect(shelter.getByRole('button', { name: 'Weiß nicht' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Autre hauteur, illisible puis improbable : refusée avec un message.
	await height.getByRole('button', { name: 'Andere' }).click();
	const other = page.getByRole('textbox', { name: 'Andere Höhe, in Metern' });
	await other.fill('hoch');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('alert')).toContainText('Höhe unklar');
	await other.fill('3');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('alert')).toContainText('Unwahrscheinliche Bahnsteighöhe');
	await other.fill('0,76');
	await shelter.getByRole('button', { name: 'Nein' }).click();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(/\/gare\/carte/);

	await page.goto(`/envoi/?id=${AMB_ID}`);
	await page.getByRole('button', { name: /1 Änderung/ }).click();
	await expect(page.getByText(/1 Änderung hochgeladen/)).toBeVisible();
	const body = calls.find((c) => c.path.endsWith('/upload'))!.body;
	const way = body.match(new RegExp(`<way id="${QUAI_A}" [^>]*>(.*?)</way>`))![1];
	// Numéros (lettre A gardée en local_ref) et équipements dans la même modification du quai.
	expect(way).toContain('<tag k="local_ref" v="A"/>');
	expect(way).toContain('<tag k="height" v="0.76"/>');
	expect(way).toContain('<tag k="shelter" v="no"/>');
	expect(way).toContain('<tag k="passenger_information_display" v="yes"/>');
	// departures_board (sans précision) reste ; bancs inchangés, pas réécrits en double.
	expect(way).toContain('<tag k="departures_board" v="yes"/>');
	expect(way.match(/k="bench"/g)).toHaveLength(1);
	expect(body.match(/<way /g)).toHaveLength(1);
});

// ---------- Étape 2 : ascenseurs et distributeurs de billets ----------
const ELEVATOR = 13909180298; // ascenseur relié aux chemins piétons, sans « wheelchair »
const TICKET = 12617876405; // distributeur de billets isolé (nœud seul)
const sheetOf = (page: Page) => page.getByRole('region', { name: 'Objet sélectionné' });

test('placer un ascenseur par rapport au quai A, puis l’envoyer (nœud isolé, niveau du quai)', async ({
	page
}) => {
	const calls = await setup(page, AMB.elements as El[]);
	await page.goto(`/gare/carte/?id=${AMB_ID}`);
	// Filtre et légende : les équipements ont les leurs.
	await expect(page.getByRole('button', { name: 'Équipements' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'Ajouter' }).click();
	await expect(page.getByRole('navigation', { name: 'Que voulez-vous ajouter ?' })).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('link', { name: 'Ascenseur' }).click();

	await expect(page).toHaveURL(/\/gare\/equipement\/?\?id=w67074448&kind=elevator/);
	await page.getByRole('button', { name: 'À l’intérieur ou sous terre' }).click();
	await page.getByRole('button', { name: /^Quai A/ }).click();
	await page.getByRole('button', { name: 'Bout côté ouest' }).click();
	await page.getByRole('button', { name: 'Côté voie 13Mag' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'dans le contour du quai' })
	).toContainText('Niveau du quai : 0');
	// Niveau prérempli avec celui du quai.
	await expect(page.getByRole('textbox', { name: 'Niveaux desservis' })).toHaveValue('0');
	await page.getByRole('textbox', { name: 'Niveaux desservis' }).fill('-1;0');
	await group(page, 'Accessible en fauteuil roulant').getByRole('button', { name: 'Oui' }).click();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	await expect(page).toHaveURL(/focus=node\/-1/);
	await expect(sheetOf(page).getByRole('heading', { name: 'Ascenseur' })).toBeVisible();
	await expect(sheetOf(page)).toContainText('Niveau -1, 0');
	await expectAccessible(page);

	await page.goto(`/envoi/?id=${AMB_ID}`);
	await page.getByRole('button', { name: 'Envoyer 1 modification' }).click();
	await expect(page.getByText('1 modification envoyée.')).toBeVisible();
	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!.body;
	expect(create).toContain('ajouté : Ascenseur');
	expect(create).toContain('<tag k="source" v="survey"/>');
	// Situé sur un quai : la photo aérienne n'a pas servi.
	expect(create).not.toContain('imagery_used');
	const body = calls.find((c) => c.path.endsWith('/upload'))!.body;
	expect(body).toMatch(
		/<create><node id="-1" changeset="1234" lat="[\d.]+" lon="[\d.]+"><tag k="highway" v="elevator"\/><tag k="level" v="-1;0"\/><tag k="wheelchair" v="yes"\/><tag k="check_date" v="[\d-]+"\/><\/node><\/create>/
	);
	// Rien d'autre : aucun chemin modifié (nœud isolé).
	expect(body).not.toContain('<modify>');
});

test('doublon : un ascenseur à moins de 5 m est annoncé avant d’en créer un autre (placé sur la photo)', async ({
	page
}) => {
	await setup(page, AMB.elements as El[]);
	const n = (AMB.elements as El[]).find((e) => e.type === 'node' && e.id === ELEVATOR)!;
	await page.goto(`/gare/placer/?id=${AMB_ID}&kind=elevator&lon=${n.lon}&lat=${n.lat}`);
	await expect(page.getByRole('heading', { name: 'Placer : Ascenseur' })).toBeVisible();
	await page.getByRole('button', { name: 'Valider la position' }).click();
	await expect(page).toHaveURL(/\/gare\/equipement.*kind=elevator&lon=/);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	const warn = page.getByRole('alert').filter({ hasText: 'déjà cartographié' });
	await expect(warn).toContainText(/Ascenseur déjà cartographié à 0\s?m/);
	await expect(warn.getByRole('link', { name: 'Modifier celui-ci' })).toHaveAttribute(
		'href',
		new RegExp(`osm=node/${ELEVATOR}`)
	);
	await expectAccessible(page);
	await warn.getByRole('button', { name: 'En créer un autre' }).click();
	await expect(page).toHaveURL(/focus=node\/-1/);
});

test('équipement existant : compléter l’ascenseur ; supprimer un distributeur (isolé) avec motif', async ({
	page
}) => {
	const calls = await setup(page, AMB.elements as El[]);
	// E4 : quête « accès en fauteuil à préciser ».
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(
		page.getByRole('link', { name: /3 ascenseurs : accès en fauteuil à préciser/ })
	).toBeVisible();

	await page.goto(`/gare/carte/?id=${AMB_ID}&focus=node/${ELEVATOR}`);
	const sheet = sheetOf(page);
	await expect(sheet.getByRole('heading', { name: 'Ascenseur' })).toBeVisible();
	await expect(sheet).toContainText('Accès en fauteuil roulant à préciser');
	// Relié aux chemins piétons : pas de suppression dans l'appli.
	await sheet.getByRole('button', { name: 'Plus d’actions' }).click();
	await expect(sheet.getByText(/à supprimer avec un éditeur comme iD ou JOSM/)).toBeVisible();
	await sheet.getByRole('link', { name: 'Renseigner' }).click();
	await expect(page.getByRole('textbox', { name: 'Niveaux desservis' })).toHaveValue('-1;0');
	await group(page, 'Accessible en fauteuil roulant').getByRole('button', { name: 'Non' }).click();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(new RegExp(`focus=node/${ELEVATOR}`));

	// Distributeur isolé : suppression avec motif.
	await page.goto(`/gare/carte/?id=${AMB_ID}&focus=node/${TICKET}`);
	await expect(sheet.getByRole('heading', { name: 'Distributeur de billets' })).toBeVisible();
	await expect(sheet).toContainText('SNCF Voyageurs');
	await sheet.getByRole('button', { name: 'Plus d’actions' }).click();
	await sheet.getByRole('button', { name: 'Supprimer cet équipement…' }).click();
	await expect(sheet.getByRole('heading', { name: 'Supprimer cet équipement ?' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Supprimer l’équipement' }).click();
	await expect(sheet.getByRole('alert')).toContainText('motif');
	await sheet.getByRole('radio', { name: 'En double' }).check();
	await expectAccessible(page);
	await sheet.getByRole('button', { name: 'Supprimer l’équipement' }).click();
	await expect(page.getByText(/Distributeur de billets/).first()).toBeVisible();

	// La suppression est enregistrée en arrière-plan : sur une machine lente (CI), la page
	// d'envoi peut s'ouvrir avant. On la recharge tant que les 2 modifications n'y sont pas.
	const send = page.getByRole('button', { name: 'Envoyer 2 modifications' });
	await expect(async () => {
		await page.goto(`/envoi/?id=${AMB_ID}`);
		await expect(send).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 15_000 });
	await send.click();
	await expect(page.getByText('2 modifications envoyées.')).toBeVisible();
	const create = calls.find((c) => c.path.endsWith('/changeset/create'))!.body;
	expect(create).toContain('Distributeur de billets supprimé (en double)');
	expect(create).toContain('ascenseurs et distributeurs complétés');
	// Le nœud a été relu (chemins et relations) avant d'être supprimé.
	expect(calls.some((c) => c.path.endsWith(`/node/${TICKET}/ways.json`))).toBe(true);
	const body = calls.find((c) => c.path.endsWith('/upload'))!.body;
	expect(body).toMatch(new RegExp(`<delete><node id="${TICKET}" version="3"`));
	const elev = body.match(new RegExp(`<node id="${ELEVATOR}" [^>]*>(.*?)</node>`))![1];
	expect(elev).toContain('<tag k="wheelchair" v="no"/>');
	expect(elev).toContain('<tag k="level" v="-1;0"/>');
});

// ---------- Étape 3 : escaliers et escaliers mécaniques existants ----------
const STAIRS = 1357219277;
const ESCALATOR = 1362814613;
/** Ambérieu, avec un escalier sans réponses et un escalier mécanique au sens inconnu. */
function withSteps(): El[] {
	const els = structuredClone(AMB.elements) as El[];
	const st = els.find((e) => e.type === 'way' && e.id === STAIRS)!;
	for (const k of ['incline', 'handrail', 'tactile_paving']) delete st.tags![k];
	const esc = els.find((e) => e.type === 'way' && e.id === ESCALATOR)!;
	esc.tags = { ...esc.tags, conveying: 'yes' };
	return els;
}

test('compléter le sens d’un escalier et d’un escalier mécanique, sans jamais retourner le chemin', async ({
	page
}) => {
	const els = withSteps();
	const calls = await setup(page, els);
	await page.goto(`/gare/?id=${AMB_ID}`);
	await expect(page.getByRole('link', { name: /1 escalier à compléter/ })).toContainText(
		'Sens de montée, mains courantes et bandes podotactiles'
	);
	await expect(
		page.getByRole('link', { name: /1 escalier mécanique ou tapis : sens de marche à relever/ })
	).toBeVisible();

	await page.goto(`/gare/carte/?id=${AMB_ID}&focus=way/${STAIRS}`);
	const sheet = sheetOf(page);
	await expect(sheet.getByRole('heading', { name: 'Escalier' })).toBeVisible();
	await expect(sheet).toContainText('À compléter : sens de montée, mains courantes et bandes');
	// Pas de suppression d'un escalier : seulement « Voir sur OpenStreetMap ».
	await expect(sheet.getByRole('button', { name: 'Plus d’actions' })).toHaveCount(0);
	await expectAccessible(page);
	await sheet.getByRole('link', { name: 'Renseigner' }).click();

	await expect(page).toHaveURL(new RegExp(`/gare/escalier.*osm=way/${STAIRS}`));
	await expect(page.getByRole('img', { name: /Schéma : escalier en trait épais/ })).toBeVisible();
	await page
		.getByRole('group', {
			name: 'Dans le sens de la flèche, l’escalier monte-t-il ou descend-il ?'
		})
		.getByRole('button', { name: 'Il descend' })
		.click();
	await group(page, 'Mains courantes (en suivant la flèche)')
		.getByRole('button', { name: 'Des deux côtés' })
		.click();
	await group(page, 'Bandes podotactiles en haut et en bas')
		.getByRole('button', { name: 'Oui' })
		.click();
	await page.getByRole('textbox', { name: 'Nombre de marches' }).fill('vingt');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('alert')).toContainText('Nombre de marches illisible');
	await page.getByRole('textbox', { name: 'Nombre de marches' }).fill('24');
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(new RegExp(`focus=way/${STAIRS}`));
	await expect(sheet).toContainText('Flèche vers le haut · Niveau -1, 0 · 24 marches');

	await page.goto(`/gare/escalier/?id=${AMB_ID}&osm=way/${ESCALATOR}`);
	await expect(page.getByRole('heading', { name: 'Escalier mécanique' })).toBeVisible();
	// Sens de montée déjà connu (incline=up) : prérempli.
	await expect(page.getByRole('button', { name: 'Il monte' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'À contre-sens de la flèche' }).click();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page).toHaveURL(new RegExp(`focus=way/${ESCALATOR}`));

	await page.goto(`/envoi/?id=${AMB_ID}`);
	await page.getByRole('button', { name: 'Envoyer 2 modifications' }).click();
	await expect(page.getByText('2 modifications envoyées.')).toBeVisible();
	expect(calls.find((c) => c.path.endsWith('/changeset/create'))!.body).toContain(
		'escaliers complétés'
	);
	const body = calls.find((c) => c.path.endsWith('/upload'))!.body;
	const wayXml = (id: number) => body.match(new RegExp(`<way id="${id}" [^>]*>(.*?)</way>`))![1];
	const nds = (id: number) =>
		[...wayXml(id).matchAll(/<nd ref="(\d+)"\/>/g)].map((m) => Number(m[1]));
	for (const id of [STAIRS, ESCALATOR])
		expect(nds(id)).toEqual(els.find((e) => e.type === 'way' && e.id === id)!.nodes);
	expect(wayXml(STAIRS)).toContain('<tag k="incline" v="down"/>');
	expect(wayXml(STAIRS)).toContain('<tag k="handrail:left" v="yes"/>');
	expect(wayXml(STAIRS)).toContain('<tag k="handrail:right" v="yes"/>');
	expect(wayXml(STAIRS)).toContain('<tag k="tactile_paving" v="yes"/>');
	expect(wayXml(STAIRS)).toContain('<tag k="step_count" v="24"/>');
	expect(wayXml(ESCALATOR)).toContain('<tag k="conveying" v="backward"/>');
	expect(wayXml(ESCALATOR)).toContain('<tag k="incline" v="up"/>');
	expect(body).not.toContain('<create>');
});
