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
lieux, distances et durées, mais sans textes rédigés. Pour l'activer, renseignez
`GEMINI_API_KEY` dans `.env.local` :

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
