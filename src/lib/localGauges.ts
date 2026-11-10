// Jauges exactes et prochaine tâche d'une gare déjà ouverte sur ce téléphone (E3 : carte
// « Reprendre », fiches) : analyse locale des données en cache, saisies en attente comprises,
// comme le tableau de bord (E4). Chargé à part (import dynamique) par la page « Choisir une gare ».

import type { Edit } from './core/edits.js';
import type { OsmElement } from './core/osm.js';
import { groupQuests } from './questText.js';
import type { Gauges, Station } from './stations.js';
import { stationView } from './view.js';

export interface LocalState {
	gauges: Gauges;
	/**
	 * Première quête de la gare (même ordre que la liste de E4), ou undefined si tout est fait :
	 * dessin d'un quai (Q0) ou carte centrée sur l'objet (`focus` : « way/123 »).
	 */
	next?: { title: string; draw: boolean; focus?: string };
}

export function localState(station: Station, elements: OsmElement[], edits: Edit[]): LocalState {
	const { analysis } = stationView(station, elements, edits);
	const first = groupQuests(analysis)[0];
	let next: LocalState['next'];
	if (first) {
		const target = first.quests[0].target ?? first.quests[0].platform;
		next = {
			title: first.title,
			draw: first.id === 'Q0',
			focus: target ? `${target.type}/${target.id}` : undefined
		};
	}
	return { gauges: analysis.completeness, next };
}
