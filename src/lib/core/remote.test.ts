import { describe, expect, it } from 'vitest';
import { compareVersions, parseConfig, uploadBlock, DEFAULT_CONFIG } from './remote';

describe('config.json', () => {
	it('tolère un fichier vide ou mal formé (envois permis)', () => {
		expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
		expect(parseConfig({ uploadsEnabled: 'non', message: '  ', pilotUsers: 'x' })).toEqual(
			DEFAULT_CONFIG
		);
	});
	it('lit l’arrêt, le message et les testeurs', () => {
		expect(
			parseConfig({
				uploadsEnabled: false,
				minVersion: '0.4',
				message: 'Bug',
				pilotUsers: ['a', 3]
			})
		).toEqual({
			uploadsEnabled: false,
			minVersion: '0.4',
			message: 'Bug',
			pilotUsers: ['a'],
			officialStatusEnabled: true
		});
	});
	it('coupe l’état officiel des équipements seulement sur un false explicite', () => {
		expect(parseConfig({ officialStatusEnabled: false }).officialStatusEnabled).toBe(false);
		expect(parseConfig({ officialStatusEnabled: 'non' }).officialStatusEnabled).toBe(true);
		expect(parseConfig({}).officialStatusEnabled).toBe(true);
	});
});

describe('versions', () => {
	it('compare numériquement', () => {
		expect(compareVersions('0.10', '0.9')).toBeGreaterThan(0);
		expect(compareVersions('0.4', '0.4.0')).toBe(0);
		expect(compareVersions('0.3', '0.4')).toBeLessThan(0);
	});
});

describe('blocage des envois', () => {
	const ok = DEFAULT_CONFIG;
	it('laisse passer par défaut', () => {
		expect(uploadBlock(ok, '0.4', true, 'x')).toBeUndefined();
	});
	it('arrêt d’urgence : message choisi, ou message par défaut', () => {
		expect(uploadBlock({ ...ok, uploadsEnabled: false, message: 'Bug' }, '0.4', false)).toBe('Bug');
		expect(uploadBlock({ ...ok, uploadsEnabled: false }, '0.4', false)).toMatch(/suspendus/);
	});
	it('version trop ancienne', () => {
		expect(uploadBlock({ ...ok, minVersion: '0.5' }, '0.4', false)).toMatch(/nouvelle version/);
	});
	it('pilote : réservé aux testeurs sur la vraie carte, libre sur le serveur de test', () => {
		const pilot = { ...ok, pilotUsers: ['Testeur'] };
		expect(uploadBlock(pilot, '0.4', true, 'Testeur')).toBeUndefined();
		expect(uploadBlock(pilot, '0.4', true, 'Autre')).toMatch(/pilote/);
		expect(uploadBlock(pilot, '0.4', true)).toMatch(/pilote/);
		expect(uploadBlock(pilot, '0.4', false, 'Autre')).toBeUndefined();
	});
});

describe('static/config.json publié', () => {
	it('est un JSON valide, avec des champs bien typés (sinon le déploiement échoue)', async () => {
		const { readFileSync } = await import('node:fs');
		const raw = JSON.parse(readFileSync('static/config.json', 'utf8'));
		expect(typeof raw.uploadsEnabled).toBe('boolean');
		expect(raw.minVersion).toMatch(/^\d+(\.\d+)*$/);
		expect(raw.message === null || typeof raw.message === 'string').toBe(true);
		expect(
			raw.pilotUsers === null ||
				(Array.isArray(raw.pilotUsers) &&
					raw.pilotUsers.every((u: unknown) => typeof u === 'string'))
		).toBe(true);
		expect(typeof raw.officialStatusEnabled).toBe('boolean');
		expect(parseConfig(raw)).toEqual({ ...raw, message: raw.message?.trim() || null });
	});
});
