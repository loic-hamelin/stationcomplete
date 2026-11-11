# Glossaire de l'interface (fr, en, de, it, es)

Vocabulaire métier de stationcomplete et sa traduction dans chaque langue de l'interface. Les traductions doivent l'employer partout (fichiers `src/lib/i18n/messages/<langue>.json`). Première version rédigée le 7 novembre 2026 ; **à relire** par Loïc (allemand) puis par la communauté OSM de chaque langue.

Légende : ⚠ = terme incertain, à faire valider (raison en note). Ne se traduisent jamais : les tags OSM, le nom « stationcomplete », les termes du schéma français des pancartes (TT, n V, L, Z57, Z50, TGV, UFR, RBT, TL, TC, US, UM), les noms propres (OpenStreetMap, OSRD, IGN – BD ORTHO, CNIL, iD, JOSM).

## Ton

| fr          | en       | de                      | it                | es                |
| ----------- | -------- | ----------------------- | ----------------- | ----------------- |
| vouvoiement | (neutre) | ⚠ tutoiement « du » (1) | tutoiement « tu » | tutoiement « tú » |

(1) Choix de StreetComplete et d'iD en allemand ; une appli d'opérateur ferroviaire vouvoierait (« Sie »). À trancher par Loïc.

## Gare et infrastructure

| fr                                | en                              | de                              | it                                  | es                                    | Tag OSM                                 |
| --------------------------------- | ------------------------------- | ------------------------------- | ----------------------------------- | ------------------------------------- | --------------------------------------- |
| gare                              | station                         | Bahnhof                         | stazione                            | estación                              | `railway=station`                       |
| halte                             | halt                            | Haltepunkt                      | fermata                             | apeadero                              | `railway=halt`                          |
| quai                              | platform                        | Bahnsteig                       | ⚠ marciapiede (2)                   | andén                                 | `railway=platform`                      |
| bord du quai                      | platform edge                   | Bahnsteigkante                  | bordo del marciapiede               | borde del andén                       | `railway=platform_edge`                 |
| voie                              | track                           | Gleis                           | binario                             | vía                                   | `railway=rail`                          |
| numéro de voie                    | track number                    | Gleisnummer                     | numero di binario                   | número de vía                         | `railway:track_ref`                     |
| numéro / lettre du quai           | platform number / letter        | Bahnsteignummer / -buchstabe    | numero / lettera del marciapiede    | número / letra del andén              | `ref`, `local_ref`                      |
| pancarte d'arrêt                  | ⚠ stop marker (3)               | ⚠ Haltetafel (4)                | ⚠ tabella di fermata (5)            | ⚠ cartel de parada (6)                | `railway:signal:stop=FR:passenger_stop` |
| repère de quai (lettre A, B…)     | ⚠ platform sector marker        | ⚠ Sektorenkennzeichnung         | ⚠ riferimento di settore            | ⚠ referencia de sector                | —                                       |
| ligne de sécurité                 | safety line                     | Sicherheitslinie                | linea di sicurezza                  | línea de seguridad                    | —                                       |
| zone d'arrêt                      | stop area                       | ⚠ Haltestellenbereich           | area di fermata                     | área de parada                        | `public_transport=stop_area`            |
| ligne (relation)                  | route                           | Linie                           | linea                               | línea                                 | `type=route`                            |
| aiguillage                        | switch                          | Weiche                          | deviatoio                           | desvío                                | `railway=switch`                        |
| conducteur                        | driver                          | Triebfahrzeugführer             | macchinista                         | maquinista                            | —                                       |
| train long / court / tous trains  | long / short train / all trains | langer / kurzer Zug / alle Züge | treno lungo / corto / tutti i treni | tren largo / corto / todos los trenes | ⚠ (7)                                   |
| unité simple / multiple (US / UM) | single / multiple unit          | Einfach- / Mehrfachtraktion     | ⚠ singola / multipla                | ⚠ simple / múltiple                   | `…:for=single_unit/multiple_unit`       |
| souterrain                        | underground                     | unterirdisch                    | sotterraneo                         | subterráneo                           | `tunnel`, `layer<0`, `level<0`          |
| partie (d'un quai)                | part                            | Teil                            | parte                               | parte                                 | — (quai en plusieurs objets)            |
| partie couverte                   | covered part                    | ⚠ überdeckter Teil (8)          | parte coperta                       | parte cubierta                        | `layer<0`, `covered=yes`, `tunnel`…     |
| partie à l'air libre              | open-air part                   | Teil unter freiem Himmel        | parte all'aperto                    | parte al aire libre                   | —                                       |

(2) En italien, RFI dit « marciapiede » pour le quai ferroviaire ; le wiki OSM italien emploie aussi « banchina ». À trancher par la communauté OSM italienne.
(3) « Stop marker » (britannique, « car stop marker ») plutôt que « stop sign », qui évoque le panneau routier. Alternative : « stop board ».
(4) Allemagne : Haltetafel (signal Ne 5) ; Suisse : « Halteorttafel » / « Haltepunkttafel » selon les sources. À valider par Loïc, et à revoir pour la Suisse (de-CH écrira aussi « ss » au lieu de « ß »).
(5) Proposition de Loïc ; RFI emploie aussi « cartello di fermata ». À valider.
(6) ADIF emploie aussi « cartelón de parada » ou « señal de parada ». À valider.
(7) Libellés des boutons de la grille E7 : ils décrivent la pancarte française, dont le texte reste en français sur le terrain.
(8) Partie d'un quai couverte par une dalle ou un bâtiment (Paris-Saint-Lazare, sous la place de l'Europe). « überdacht » désignerait plutôt un abri de quai ; « überdeckt » suit la dalle. À valider par Loïc.

## OpenStreetMap et appli

| fr                                | en                      | de                       | it                        | es                          |
| --------------------------------- | ----------------------- | ------------------------ | ------------------------- | --------------------------- |
| contribution                      | contribution            | Beitrag                  | contributo                | contribución                |
| saisie (modification locale)      | edit                    | Änderung                 | modifica                  | edición                     |
| envoi / envoyer                   | upload                  | Upload / hochladen       | invio / inviare           | envío / enviar              |
| groupe de modifications           | changeset               | Änderungssatz            | gruppo di modifiche       | conjunto de cambios         |
| description publique de l'envoi   | public description      | öffentliche Beschreibung | descrizione pubblica      | descripción pública         |
| pseudo                            | username                | Benutzername             | nome utente               | nombre de usuario           |
| serveur de test                   | test server             | Testserver               | server di prova           | servidor de pruebas         |
| mode démonstration                | demo mode               | Demomodus                | modalità dimostrativa     | modo demostración           |
| sur place / à distance            | on site / remote        | vor Ort / aus der Ferne  | sul posto / a distanza    | in situ / a distancia       |
| hors-ligne                        | offline                 | offline                  | offline                   | sin conexión                |
| photo aérienne                    | aerial photo            | Luftbild                 | foto aerea                | foto aérea                  |
| tableau de bord (E4)              | dashboard               | Übersicht                | pannello                  | panel                       |
| fiche (E7)                        | details                 | Details                  | scheda                    | ficha                       |
| favorite (gare)                   | favourite               | Favorit                  | preferita                 | favorita                    |
| reprendre (gare en cours)         | resume                  | fortsetzen               | riprendere                | reanudar                    |
| jauge (quais · voies · pancartes) | gauge                   | Anzeige                  | indicatore                | indicador                   |
| à compléter / N à faire           | to complete / N to do   | zu ergänzen / N offen    | da completare / N da fare | por completar / N por hacer |
| pays des gares                    | country of the stations | Land der Bahnhöfe        | paese delle stazioni      | país de las estaciones      |
| renseigner                        | fill in                 | erfassen                 | compilare                 | completar                   |
| relever (sur place)               | note                    | erfassen                 | rilevare                  | anotar                      |
| à revoir (conflit)                | to review               | zu überprüfen            | da rivedere               | por revisar                 |
| tags                              | tags                    | Tags                     | tag                       | etiquetas                   |
| croix (réticule)                  | crosshair               | Fadenkreuz               | mirino                    | cruz                        |
| accrocher à la voie               | snap to the track       | am Gleis einrasten       | agganciare al binario     | ajustar a la vía            |
| contour, point                    | outline, point          | Umriss, Punkt            | contorno, punto           | contorno, punto             |
| redessiner en surface             | redraw as an area       | als Fläche neu zeichnen  | ridisegnare come area     | redibujar como área         |
| relation                          | relation                | Relation                 | relazione                 | relación                    |
| légende                           | legend                  | Legende                  | legenda                   | leyenda                     |

## Objets voisins d'un quai (messages `obj.*`)

Chaque langue donne le nom, les formes avec article (`a` : « le toit » / « un bâtiment », `of` : « du toit », `the` : « le toit ») et le genre grammatical `g` (m, f, n) qui sert aux accords. Allemand : `of` au génitif, `a` et `the` au nominatif.

| fr                               | en                        | de                    | it                             | es                            |
| -------------------------------- | ------------------------- | --------------------- | ------------------------------ | ----------------------------- |
| toit                             | roof                      | Dach                  | tetto                          | techo                         |
| espace intérieur                 | indoor space              | Innenraum             | spazio interno                 | espacio interior              |
| escalier                         | steps                     | Treppe                | scala                          | escalera                      |
| chemin piéton                    | footpath                  | Fußweg                | percorso pedonale              | camino peatonal               |
| ascenseur                        | lift                      | Aufzug                | ascensore                      | ascensor                      |
| route                            | road                      | Straße                | strada                         | carretera                     |
| bâtiment                         | building                  | Gebäude               | edificio                       | edificio                      |
| voie ou installation ferroviaire | track or railway facility | Gleis oder Bahnanlage | binario o impianto ferroviario | vía o instalación ferroviaria |
| clôture ou mur                   | fence or wall             | Zaun oder Mauer       | recinzione o muro              | valla o muro                  |
| zone                             | area                      | Fläche                | area                           | zona                          |
| entrée                           | entrance                  | Eingang               | ingresso                       | entrada                       |
| arrêt de bus                     | bus stop                  | Bushaltestelle        | fermata dell’autobus           | parada de autobús             |
| barrière                         | barrier                   | Absperrung            | barriera                       | barrera                       |
| élément ferroviaire              | railway feature           | ⚠ Bahnelement         | elemento ferroviario           | elemento ferroviario          |

## Termes à faire valider, par langue

- **en** : « stop marker » (pancarte d'arrêt) ; « platform sector marker » (repère de quai) ; anglais britannique choisi (lift, metres, dates jour/mois).
- **de** : « du » ou « Sie » ; « Haltetafel » (et la variante suisse) ; « Sektorenkennzeichnung » ; « Haltestellenbereich » (stop area) ; « Bahnelement » ; « Triebfahrzeugführer » ; « Einfach-/Mehrfachtraktion » pour US/UM ; « ß » pour l'Allemagne.
- **it** : « marciapiede » ou « banchina » ; « tabella di fermata » ou « cartello di fermata » ; « riferimento di settore » ; libellés US/UM.
- **es** : « cartel de parada » (ou « cartelón », « señal de parada ») ; « referencia de sector » ; « in situ » pour « sur place » ; « carretera » pour une route quelconque.
