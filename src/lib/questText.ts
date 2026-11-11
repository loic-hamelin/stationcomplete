// Textes des quêtes pour l'interface (E4, E5). Regroupe les quêtes identiques.

import { platformTitle } from './core/features.js';
import type { Quest, QuestId, StationAnalysis } from './core/quests.js';
import { fmtList, t, tk } from './i18n/t.js';

export type Kind = 'quai' | 'voie' | 'pancarte' | 'alerte' | 'verif' | 'equip';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Noms des équipements à relever (« hauteur, abri et bancs »), dans l'ordre de la fiche. */
export function equipmentItems(missing: string[]) {
	return fmtList(missing.map((m) => tk(`equip.item.${m}`)));
}

export interface QuestGroup {
	id: QuestId;
	kind: Kind;
	title: string;
	subtitle?: string;
	count: number;
	onSite: boolean;
	quests: Quest[];
}

export function platformLabel(a: StationAnalysis, ref?: { id: number }) {
	const p = a.platforms.find((x) => x.ref.id === ref?.id);
	return p ? platformTitle(p.tags) : t('platform.plain');
}

export function groupQuests(a: StationAnalysis): QuestGroup[] {
	const by = new Map<QuestId, Quest[]>();
	for (const q of a.quests) by.set(q.id, [...(by.get(q.id) ?? []), q]);
	const groups: QuestGroup[] = [];
	for (const [id, qs] of by) {
		const n = qs.length;
		const base = { id, count: n, onSite: qs[0].onSite, quests: qs };
		switch (id) {
			case 'Q0':
				groups.push({
					...base,
					kind: 'alerte',
					title: t('quest.q0.title'),
					subtitle: t('quest.q0.subtitle')
				});
				break;
			case 'Q1':
				groups.push({
					...base,
					kind: 'quai',
					title: t('quest.q1.title', { count: n })
				});
				break;
			case 'Q2':
				groups.push({
					...base,
					kind: 'voie',
					title: t('quest.q2.title', { count: n })
				});
				break;
			case 'Q3':
				groups.push({
					...base,
					kind: 'quai',
					title: t('quest.q3.title', { count: n }),
					// Quai en plusieurs parties aux numéros différents (sans correction automatique).
					subtitle: qs.every((q) => q.details?.motif === 'parties')
						? t('quest.q3.partsSubtitle')
						: t('quest.q3.subtitle')
				});
				break;
			case 'Q4':
				groups.push({
					...base,
					kind: 'pancarte',
					title: t('quest.q4.title', { count: n }),
					subtitle: [...new Set(qs.map((q) => platformLabel(a, q.platform)))].slice(0, 3).join(', ')
				});
				break;
			case 'Q5':
				groups.push({
					...base,
					kind: 'pancarte',
					title: t('quest.q5.title', { count: n })
				});
				break;
			case 'Q6':
				groups.push({
					...base,
					kind: 'verif',
					title: t('quest.q6.title', { count: n }),
					subtitle: t('quest.q6.subtitle')
				});
				break;
			case 'Q8': {
				// Équipements des quais : un seul groupe, sous-titre = ce qui manque le plus souvent.
				const all = new Set(qs.flatMap((q) => (q.details?.missing as string[]) ?? []));
				const items = equipmentItems(
					['height', 'display', 'shelter', 'tactile', 'bench'].filter((m) => all.has(m))
				);
				groups.push({
					...base,
					kind: 'equip',
					title: t('quest.q8.title', { count: n }),
					subtitle: items.charAt(0).toUpperCase() + items.slice(1)
				});
				break;
			}
			case 'Q10':
			case 'Q11':
				groups.push({
					...base,
					kind: 'equip',
					title: t(id === 'Q10' ? 'quest.q10.title' : 'quest.q11.title', { count: n }),
					...(id === 'Q10'
						? {
								subtitle: capitalize(
									fmtList(
										['incline', 'handrail', 'tactile']
											.filter((m) => qs.some((q) => (q.details?.missing as string[]).includes(m)))
											.map((m) => tk(`steps.item.${m}`))
									)
								)
							}
						: {})
				});
				break;
			case 'Q9':
				groups.push({ ...base, kind: 'equip', title: t('quest.q9.title', { count: n }) });
				break;
			case 'Q7':
				groups.push({
					...base,
					kind: 'alerte',
					title:
						qs[0].details?.motif === 'numéro en double'
							? t('quest.q7.duplicate', { ref: String(qs[0].details?.ref) })
							: t('quest.q7.title', { count: n }),
					subtitle: t('quest.q7.subtitle')
				});
				break;
		}
	}
	return groups;
}
