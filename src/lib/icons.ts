// Jeu d'icônes maison (refonte v1) : grille 24 px, trait 1,5 px, extrémités arrondies,
// couleur héritée du texte (stroke="currentColor"). Source : maquettes, build/icons.svg.
export const ICONS = {
	quai: '<rect x="3" y="7.5" width="18" height="9" rx="1"/><path d="M5.5 13.5h13"/>',
	voie: '<path d="M3 9.5h18M3 14.5h18M6.5 7.5v9M10.5 7.5v9M14.5 7.5v9M18.5 7.5v9"/>',
	pancarte: '<rect x="7" y="3" width="10" height="9" rx="1"/><path d="M12 12v9M9.5 21h5"/>',
	back: '<path d="M15 5l-7 7 7 7"/>',
	close: '<path d="M6 6l12 12M18 6L6 18"/>',
	search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
	locate:
		'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5"/>',
	layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	minus: '<path d="M5 12h14"/>',
	check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
	alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.2"/>',
	question:
		'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 16.6v.2"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	chev: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
	download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
	send: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
	gare: '<path d="M4 20V10l8-5 8 5v10M3 20h18M10 20v-5h4v5"/>',
	list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.5M4.5 12h.5M4.5 17h.5"/>',
	settings:
		'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
	lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
	map: '<path d="M3 6.5l6-2 6 2 6-2v13l-6 2-6-2-6 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
	'arrow-l': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
	'arrow-r': '<path d="M5 12h14M13 6l6 6-6 6"/>',
	'arrow-u': '<path d="M12 19V5M6 11l6-6 6 6"/>',
	'arrow-d': '<path d="M12 5v14M6 13l6 6 6-6"/>',
	undo: '<path d="M9 13L4 8l5-5"/><path d="M4 8h10a6 6 0 0 1 0 12h-3"/>',
	ext: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
	star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
	offline:
		'<path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.6-2.5M14.4 10.1A10 10 0 0 1 19 12.6M2 9.2a15 15 0 0 1 4.3-2.7M10.6 5.1A15 15 0 0 1 22 9.2M12 19.5h.01"/>',
	refresh: '<path d="M19.5 11a7.5 7.5 0 1 0-2.2 5.5M20 4.5V11h-6.5"/>',
	pen: '<path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z"/><path d="M13.5 7.3l3.2 3.2"/>',
	more: '<circle cx="12" cy="5.5" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="12" cy="18.5" r=".9"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
	// Lot 7 : forme d'un quai (contour et sommets).
	shape:
		'<path d="M5 7l12-2 2 10-14 3z"/><circle cx="5" cy="7" r="1.6"/><circle cx="17" cy="5" r="1.6"/><circle cx="19" cy="15" r="1.6"/><circle cx="5" cy="18" r="1.6"/>',
	// Lot « Équipements » : équipements des quais (banc), ascenseur, distributeur de billets,
	// escalier, escalier mécanique.
	equip: '<path d="M4 10.5h16M4 14.5h16M6 14.5v5M18 14.5v5M6.5 10.5V6h11v4.5"/>',
	elevator:
		'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 10l3-3 3 3M9 14l3 3 3-3"/>',
	ticket:
		'<path d="M3.5 7h17v3a2 2 0 0 0 0 4v3h-17v-3a2 2 0 0 0 0-4z"/><path d="M14.5 8v1.5M14.5 11.25v1.5M14.5 14.5V16"/>',
	steps: '<path d="M3 20h5v-4h4v-4h4V8h5"/>',
	stairs: '<path d="M3 20h5v-4h4v-4h4V8h5"/>',
	walkway: '<path d="M3 17.5h18M3 13.5h18M7 8h9M13.5 5.5L16 8l-2.5 2.5"/>',
	escalator: '<path d="M3 19.5h5L17 9h4M3 15h3.5l9-10.5H21"/>',
	// Ajout pour l'intégration : pavé de micro-déplacement (quatre flèches).
	nudge:
		'<path d="M12 4v16M4 12h16M9.5 6.5L12 4l2.5 2.5M9.5 17.5L12 20l2.5-2.5M6.5 9.5L4 12l2.5 2.5M17.5 9.5L20 12l-2.5 2.5"/>'
};

export type IconName = keyof typeof ICONS;
