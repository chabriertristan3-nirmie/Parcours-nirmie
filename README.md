# NirmieRoute

Générateur de parcours touristiques à pied pour l'application **Nirmie**.

On saisit une ville, on obtient d'abord **l'inventaire de ses lieux touristiques**,
puis autant de parcours que cette ville peut réellement porter.

## Le principe

Le nombre de parcours n'est pas décidé à l'avance : il se **déduit** du nombre
de lieux disponibles et de la taille de parcours souhaitée.

```
capacité = (lieux retenus × réutilisations autorisées) ÷ arrêts minimum par parcours
```

Une ville de 60 lieux, avec des parcours d'au moins 4 arrêts, porte 15 parcours.
Passez le minimum à 6 : elle en porte 10. C'est le terrain qui décide.

## Le parcours utilisateur

1. **Ville** — saisie du nom, géocodage.
2. **Lieux** — l'inventaire complet s'affiche : nombre total, répartition par
   thème, carte, notoriété de chaque lieu. On filtre, on écarte, on ajoute.
3. **Réglages** — nombre d'arrêts (min / cible / max), distance maximale,
   boucle, composition thématique, réutilisation des lieux. La capacité se
   recalcule en direct à chaque changement.
4. **Parcours** — génération, consultation, export.

## Qui fait quoi

| Étape | Responsable | Pourquoi |
|---|---|---|
| Trouver les lieux | OpenStreetMap (Overpass) | Données réelles, exhaustives, coordonnées exactes |
| Classer et noter les lieux | `services/osmService.ts` | Règles explicites sur les tags OSM |
| Composer et ordonner les parcours | `services/routePlanner.ts` | Déterministe : mêmes réglages, même résultat |
| Calculer distances et durées | `services/geo.ts` | Haversine + facteur de voirie, jamais estimé au jugé |
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
