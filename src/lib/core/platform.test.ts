import { describe, expect, it } from 'vitest';
import { isPlatform } from './osm';

// Issue #1 (cquest) : public_transport=platform sans train=yes doit compter comme quai de train,
// sauf si un autre mode de transport est précisé (quai de bus, de tram…).
describe('reconnaissance des quais de train', () => {
	it('railway=platform ou public_transport=platform + train=yes', () => {
		expect(isPlatform({ railway: 'platform' })).toBe(true);
		expect(isPlatform({ public_transport: 'platform', train: 'yes' })).toBe(true);
	});
	it('public_transport=platform sans mode précisé : quai de train', () => {
		expect(isPlatform({ public_transport: 'platform', ref: '2' })).toBe(true);
	});
	it('un autre mode précisé écarte le quai', () => {
		const others: Record<string, string>[] = [
			{ bus: 'yes' },
			{ tram: 'yes' },
			{ subway: 'yes' },
			{ light_rail: 'yes' },
			{ highway: 'bus_stop' },
			{ highway: 'platform' },
			{ railway: 'tram_stop' },
			{ train: 'no' }
		];
		for (const t of others) expect(isPlatform({ public_transport: 'platform', ...t })).toBe(false);
	});
	it('train=yes l’emporte même avec un autre mode (quai partagé train + tram)', () => {
		expect(isPlatform({ public_transport: 'platform', train: 'yes', tram: 'yes' })).toBe(true);
	});
	it('rien sans tag de quai', () => {
		expect(isPlatform({ highway: 'footway' })).toBe(false);
		expect(isPlatform()).toBe(false);
	});
});
