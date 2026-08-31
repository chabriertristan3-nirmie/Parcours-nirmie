# NirmieRoute

Générateur de parcours touristiques à pied pour l'application **Nirmie**.

On saisit une ville, on obtient d'abord **l'inventaire de ses lieux touristiques**,
puis autant de parcours que cette ville peut réellement porter.

## Deux familles de parcours

Le choix se fait au tout premier écran, avant la ville.

**Parcours touristique — les lieux commandent.** On relève tous les lieux
touristiques, on retient ceux qu'on veut, le générateur les enchaîne en
parcours de visite avec arrêts, temps de visite et anecdotes. C'est le mode
décrit dans le reste de ce document.

**Parcours libre — la distance commande, et rien d'autre.** Vous donnez une
longueur et un point de départ, le générateur trace une boucle aléatoire de
cette longueur par les rues et les chemins. **Aucun point d'intérêt n'est
utilisé** : c'est précisément ce qui rend ce mode possible dans une ville qui
n'a rien à visiter. Mode balade, footing, sortie vélo — un entre-deux entre
l'exploration libre, non guidée, et le parcours touristique, entièrement guidé.

### Comment la boucle est tracée

Le mode libre **n'interroge jamais l'inventaire des lieux**. Il ne fait qu'une
requête de géocodage pour situer la ville, puis travaille sur la seule
géométrie :

1. Une **forme** est tirée au hasard : 3 à 6 jalons, rayons inégaux (75 à
   125 % du rayon nominal) et angles décalés. Un cercle parfait donnerait
   toujours le même circuit ennuyeux.
2. Les jalons sont posés autour du départ, et le routeur les relie par les
   rues réelles.
3. Si le circuit obtenu ne fait pas la bonne longueur, **seul le rayon est
   corrigé** — la forme ne bouge pas, ce qui fait converger en deux ou trois
   essais, à moins de 12 % de la cible.

Le guidage vient des **noms de rues** que le routeur renvoie pour chaque jalon :
« rue des Écoles », « avenue de la Libération ». Le promeneur sait où passer
sans qu'aucun lieu remarquable n'existe. Une voie sans nom devient « Point de
passage 3 ».

Les boucles d'un même lot sont réparties dans des secteurs distincts, avec une
part de hasard : elles partent dans des directions différentes, et **relancer
la génération avec les mêmes réglages donne d'autres circuits**.

### Un départ par boucle, sur toute la commune

Parties du même point, quatre boucles de 3,5 km se recouvrent : quelle que soit
leur forme, elles tournent dans le même quartier. Le générateur détermine donc
**un point de départ par boucle**, répartis sur l'ensemble du territoire
communal — c'est ce qui les rend réellement différentes.

Les départs sont posés sur l'**ellipse inscrite dans l'emprise de la commune**,
à 55 % de sa demi-étendue : la forme de cette ellipse suit celle du territoire,
qu'il soit ramassé ou tout en longueur. Chacun est situé en clair : « Secteur
nord-est d'Antibes — avenue de Nice », le nom de rue venant du routeur.

Trois garde-fous :

- Une commune géocodée à l'adresse près n'a pas d'emprise. Les départs sont
  alors écartés d'au moins **un rayon de boucle**, faute de quoi les circuits se
  superposeraient à nouveau.
- Un départ **non desservi** — en mer, en forêt, hors du réseau — est détecté :
  si le routeur l'accroche à plus de 1,5 km, on le ramène à mi-chemin du centre,
  puis au centre.
- La répartition est **déterministe** : l'écran de réglages affiche et
  cartographie les départs exacts qui serviront à la génération.

Deux réglages restent possibles : « Depuis le centre » ramène toutes les boucles
au centre-ville, et un départ choisi à la main (votre position, une adresse)
l'emporte sur la répartition — toutes les boucles en partent.

## Le principe (parcours touristiques)

Le nombre de parcours n'est pas décidé à l'avance : il se **déduit** du nombre
de lieux disponibles et de la taille de parcours souhaitée.

```
capacité = (lieux retenus × réutilisations autorisées) ÷ arrêts minimum par parcours
```

Une ville de 60 lieux, avec des parcours d'au moins 4 arrêts, porte 15 parcours.
Passez le minimum à 6 : elle en porte 10. C'est le terrain qui décide.

## Cadrer par le temps

Sur l'écran de réglages d'un parcours touristique, deux façons de décider de
la taille des parcours :

- **Par les arrêts** — vous fixez les bornes min / cible / max, la durée en
  découle.
- **Par le temps** — vous donnez le temps dont vous disposez, et *tout* en
  découle : le nombre d'arrêts, la distance de marche, et donc le nombre de
  parcours que la ville peut porter.

Le second mode ne demande qu'un seul curseur. Un parcours de n arrêts coûte
n visites et n−1 trajets, d'où :

```
arrêts = (temps disponible + trajet type) ÷ (visite moyenne + trajet type)
```

Les deux termes sont **mesurés sur les lieux réellement retenus**, pas
supposés : la visite moyenne vient des durées de chaque type de lieu, le
trajet type de la distance médiane au **deuxième** plus proche voisin. Le
deuxième, et non le premier : dans une chaîne d'arrêts, le lieu suivant n'est
presque jamais le plus proche — celui-là vient d'être visité.

La capacité suit alors directement le temps. Dans une même ville : 45 min →
24 parcours de 2 arrêts, 1 h 30 → 16 parcours de 4 arrêts, 3 h → 9 parcours de
7 arrêts.

Un budget peut être **intenable** : un parcours ne descend pas sous 2 arrêts,
et deux musées à 45 min dépassent déjà l'heure et demie. L'écran le signale au
lieu de livrer silencieusement des parcours deux fois trop longs.

### Imposer le nombre d'arrêts malgré le temps

On peut vouloir les deux : « une heure et demie, en cinq arrêts ». Le cadrage
par le temps accepte alors un **nombre d'arrêts imposé** — c'est la distance de
marche qui s'ajuste pour tenir dans le budget, et les trois bornes valent
exactement le nombre demandé, sans marge.

Cette distance est le plus grand des deux termes suivants :

- le **temps que les visites laissent libre** (`temps − arrêts × visite`), ce
  qui permet de marcher davantage quand les arrêts sont peu nombreux ;
- le **trajet incompressible** entre n arrêts (`(n−1) × trajet type × 1,4`),
  parce qu'on ne peut pas marcher moins que la distance qui sépare les lieux.

Quand le second l'emporte, la consigne ne rentre pas dans le temps : l'écran
affiche le dépassement attendu et propose de baisser le nombre d'arrêts.

## Le parcours utilisateur

0. **Type** — parcours touristique ou parcours libre.
1. **Ville** — saisie du nom, géocodage.
2. **Lieux** — l'inventaire complet s'affiche : nombre total, répartition par
   thème, carte, notoriété de chaque lieu. On filtre, on écarte, on ajoute.
3. **Réglages** — cadrage par le temps ou par les arrêts, boucle, composition
   thématique, réutilisation des lieux. La capacité se recalcule en direct à
   chaque changement.
4. **Parcours** — génération, consultation, export.

## Qui fait quoi

| Étape | Responsable | Pourquoi |
|---|---|---|
| Trouver les lieux | OpenStreetMap (Overpass) | Données réelles, exhaustives, coordonnées exactes |
| Classer et noter les lieux | `services/osmService.ts` | Règles explicites sur les tags OSM |
| Composer et ordonner les parcours | `services/routePlanner.ts` | Déterministe : mêmes réglages, même résultat |
| Tracer l'itinéraire par les rues | OSRM (`services/routingService.ts`) | Chemin réellement praticable, distances exactes |
| Calculer les durées | `services/geo.ts` | Distance réelle ÷ vitesse choisie, jamais estimé au jugé |
| Rédiger les textes | Gemini | C'est son seul rôle |

L'IA ne choisit plus les lieux, ne compte plus les étapes et n'invente plus de
distances — c'était la source des incohérences de la version précédente.

## Règles de sécurité des POI

Chaque lieu passe un contrôle strict avant d'entrer dans l'inventaire
(`safetyExclusion` dans `services/osmService.ts`). Sont écartés d'office :

- **accès restreint** : `access=private/no/permit/customers`, propriétés privées ;
- **zones militaires**, quel que soit le tag ;
- **sites dangereux** : tag `hazard`, entrées de grottes, sommets, falaises,
  cavités naturelles ;
- **sites à l'abandon ou en travaux** : structures instables, accès interdits ;
- **infrastructures actives** : passages à niveau, installations électriques,
  ouvrages industriels.

Dans le doute, on écarte. Le nombre de lieux exclus est affiché sur l'écran
d'inventaire. Ces règles s'appuient sur les tags OpenStreetMap : un lieu mal
cartographié peut passer entre les mailles — la relecture humaine de
l'inventaire avant génération reste la dernière barrière.

## Modes de déplacement

- **À pied** : 1 à 15 km par parcours, rythmes 3,4 / 4,2 / 5 km/h.
- **À vélo** : 5 à 60 km par parcours, rythmes 12 / 15 / 18 km/h. L'écran de
  réglages affiche les itinéraires cyclables balisés de la commune (relations
  OSM `route=bicycle` : voies vertes, véloroutes locales, régionales et
  nationales), et le lien Google Maps passe en mode vélo — il privilégie
  alors de lui-même les pistes cyclables.

## Préconisation IA

Sur l'écran de réglages, le bouton « Préconisation IA » fait analyser
l'inventaire par Gemini : nombre de parcours conseillé, bornes d'arrêts,
distance, composition, avec une justification. Un clic applique le plan ;
tous les réglages restent modifiables ensuite. Les valeurs proposées sont
rebornées par le code avant application — l'IA ne peut pas dépasser la
capacité réelle de la ville.

## Explications de lieux

Le bouton livre (📖) de chaque lieu de l'inventaire affiche une explication :
en priorité le résumé **Wikipédia** (via les tags `wikipedia`/`wikidata`
d'OSM, avec lien vers la fiche), sinon la description **Wikidata**, et en
dernier recours un texte **rédigé par l'IA**, clairement signalé comme tel.

## Tracé réel et mode live

Les parcours ne relient pas les arrêts en ligne droite : le tracé suit les rues
et les chemins, calculé par les serveurs OSRM de la communauté OpenStreetMap
(profil piéton ou vélo selon le mode, sans clé d'API). Les distances et durées
affichées sont alors les vraies distances de trajet, plus des estimations.

Le réglage **« Tracé par les rues »** permet de le désactiver. Si le service ne
répond pas, le parcours reste produit en lignes droites et le signale
explicitement, sur la carte comme dans les données (`geometrySource`).

### Ce que contient le JSON

```jsonc
{
  "id": "route-...",
  "summary": { "title": "...", "totalDistanceKm": 3.2, "walkingMinutes": 46, "travelMode": "walk" },

  // Tracé complet du parcours, en [latitude, longitude].
  // C'est cette liste que le mode live affiche et suit.
  "path": [[45.8992, 6.1294], [45.8994, 6.1301], ...],

  // "osrm" = tracé réel par les rues, "straight" = lignes droites de secours.
  "geometrySource": "osrm",

  // "tour" (visite de lieux) ou "free" (boucle libre, visitMinutes toujours 0).
  // Absent sur les parcours produits avant l'arrivée des parcours libres : ce
  // sont des "tour".
  "summary": { "kind": "free" },

  "steps": [
    {
      "stepNumber": 2,
      "name": "Palais de l'Isle",
      "lat": 45.8989, "lng": 6.1281,
      "distanceFromPrevM": 320,        // distance réelle depuis l'étape précédente
      "durationFromPrevS": 274,        // à la vitesse choisie
      "pathFromPrev": [[...], [...]]   // tracé de ce segment seul
    }
  ],

  // Ajouté à l'export : géométrie GeoJSON standard, en [longitude, latitude].
  "geojson": { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [...] } }
}
```

**Attention à l'ordre des coordonnées.** `path` et `pathFromPrev` sont en
`[latitude, longitude]` — la convention de Leaflet, et celle du reste de
l'application. Le bloc `geojson` est en `[longitude, latitude]`, l'ordre
standard qu'attendent Mapbox, MapLibre et la plupart des SDK mobiles. Prenez
celui qui correspond à votre carte.

`pathFromPrev` permet de guider segment par segment : afficher uniquement le
tronçon vers la prochaine étape, et basculer sur le suivant à l'arrivée.

L'export GPX contient également le tracé complet, exploitable dans un GPS ou
une montre de sport.

## Export vers Supabase

1. Exécutez `supabase/schema.sql` une fois dans l'éditeur SQL de votre projet
   (Dashboard → SQL Editor). Trois tables dédiées sont créées :
   `generator_packs`, `generator_routes`, `generator_steps` — rien d'existant
   n'est touché.
2. Renseignez dans `.env.local` (Dashboard → Settings → API) :
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```
3. Relancez `npm run dev`. Un bouton **« Envoyer vers Supabase »** apparaît sur
   l'écran des parcours générés. L'envoi est rejouable : les lignes existantes
   sont mises à jour, jamais dupliquées.

## Détail des règles

**Thèmes** (déduits des tags OSM) : Patrimoine & Histoire, Panoramas & Points de
vue, Nature & Jardins, Art & Insolite, Places & Vie locale.

**Notoriété** (0-100) : score calculé à partir de la richesse des tags — une
fiche Wikidata, un classement patrimonial ou un site officiel signalent un lieu
connu. Le curseur « notoriété minimale » écarte les lieux mineurs.

**Composition d'un parcours** : on part du lieu le plus marquant encore
disponible, en s'éloignant des parcours déjà tracés pour couvrir toute la ville.
On agrège ensuite les lieux les plus proches tant que le budget de marche le
permet, puis on ordonne les arrêts (plus proche voisin + optimisation 2-opt)
pour que le tracé soit réellement marchable.

**Distances et durées** : distance à vol d'oiseau × 1,3 (facteur de voirie),
plus le temps de visite propre à chaque type de lieu. La durée affichée est
donc marche + visites, pas seulement la marche.

**Réutilisation** : désactivée, un lieu n'apparaît que dans un seul parcours.
Activée, il peut servir dans deux — ce qui double la capacité de la ville.

## Installation

```bash
npm install
npm run dev
```

La clé Gemini est optionnelle : sans elle, les parcours sont générés avec leurs
lieux, distances et durées, mais sans textes rédigés, sans préconisation IA et
sans explications de secours. Pour l'activer, créez un fichier `.env.local` à
la racine du projet :

```
GEMINI_API_KEY=votre_cle
```

OpenStreetMap ne demande aucune clé. Les scans sont mis en cache une semaine
dans le navigateur ; le bouton « Rescanner » force une nouvelle requête.

## Commandes

```bash
npm run dev        # serveur de développement
npm run build      # build de production
npm run typecheck  # vérification TypeScript
npm run test       # tests du planificateur (capacité, bornes, géométrie)
```

## Exports

Par parcours : JSON (format pivot, tout est dedans), CSV, GPX, impression PDF.
Par pack : JSON de l'ensemble des parcours d'une ville.
