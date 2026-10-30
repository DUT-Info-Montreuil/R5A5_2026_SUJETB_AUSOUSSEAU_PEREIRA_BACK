# Arch Rivals — back (Sujet B, R5A5 2026-2027)

Projet scolaire en binôme (Ausousseau / Pereira) : plateforme de tournois esport en équipes de 5.
Cours : https://cours-info.tlouvet.com/courses/R5A5-developpement-avance (contenu des chapitres en JSON :
`https://cours-info.tlouvet.com/data/subchapters/<id>.json`, ids dans `/data/courses/R5A5-developpement-avance.json`).
Sujet complet (PDF) : https://cours-info.tlouvet.com/data/projects/Projets_R5A5.pdf
Front séparé : `../R5A5_2026_SUJETB_AUSOUSSEAU_PEREIRA_FRONT/arch-rivals-front` (React + TS + Vite, port 5173).

**Le projet doit rester conforme au cours.** Avant d'ajouter ou de changer quelque chose, relire le chapitre concerné.

## Commandes

```bash
npm ci                    # .npmrc met ignore-scripts=true : le binaire better-sqlite3 précompilé suffit
cp .env.example .env      # puis remplir JWT_SECRET (32 car. min) et ADMIN_PASSWORD
npm run dev               # API sur http://localhost:3000, doc sur /docs
npm test                  # vitest, base SQLite en mémoire
npm run typecheck         # tsc, noEmit
npm run seed:admin        # crée l'admin depuis .env
npm audit                 # lancé aussi par la CI GitHub (.github/workflows/ci.yml) à chaque push sur main
```

Pas de build : `npm start` exécute le TypeScript avec tsx. Pas de linter : typescript-eslint ne supporte pas encore TypeScript 7.

## Architecture (cours 1.11 et 1.12, à respecter)

Clean Architecture, un dossier par fonctionnalité dans `src/features/` (`users`, `games`, `tournaments`, `teams`, `chat`, `bets`),
trois couches chacun. **Les dépendances vont vers l'intérieur** : infrastructure → application → domain.

- `domain/` : entités et règles métier en fonctions pures. Aucun import de framework, de base ou de bibliothèque HTTP.
  Les règles lèvent des erreurs métier (`src/shared/domain/errors.ts`) : `NotFoundError`, `AccessDeniedError`,
  `ConflictError`, `RuleViolationError`, `UnauthenticatedError`, `TooManyAttemptsError`. **Jamais de statut HTTP hors de
  `shared/infrastructure/http/errorHandler.ts`.**
- `application/` : use cases (classes de service) et interfaces dont ils dépendent (`ports.ts` : repositories, hasher, jetons).
  Les dépendances arrivent par le constructeur. Les services ne connaissent ni Express, ni SQLite, ni Socket.IO, ni pino :
  ils passent par les ports `Logger`, `UnitOfWork` (`shared/application/ports.ts`) et `RealtimeNotifier`.
- `infrastructure/` : repositories SQLite (seul endroit avec du SQL, lignes snake_case → entités camelCase),
  adaptateurs (bcrypt, JWT, throttle), `http.ts` (DTO zod d'entrée en `z.strictObject`, DTO de sortie, mappers, routes).
- `src/container.ts` est le composition root : seul endroit qui instancie les implémentations concrètes.

Routes : déclarées avec `route({...})` dans `features/*/infrastructure/http.ts`, listées dans `apiRoutes()` (`src/app.ts`).
Chaque route **doit** déclarer `access: 'public' | 'authenticated' | 'admin'` ; la même déclaration valide les entrées et
génère OpenAPI (`/docs`). Documenter les cas d'erreur propres à la route dans `errors`.

Droits (cours 3.3) : authentification par middleware (401), rôle admin par garde de route (403), droit sur la ressource
(capitaine, membre, auteur) dans le use case via les règles du domaine. Ordre des vérifications : 404, 403, puis 409.

Statuts (cours 1.8) : 400 DTO invalide, 409 contredit l'état, 422 valeurs incohérentes entre elles, 429 débit ou essais.

Journalisation (cours chapitre 2) : un service appelle `logger.info('evenement_snake_case', { champs })`, jamais pino.
Noms de champs fixes : `request_id`, `user` (identifiant, jamais l'email), `duration_ms`... Jamais de corps, jeton,
mot de passe, email ou IP.

Temps réel (cours chapitre 4) : écritures en HTTP, Socket.IO seulement pour notifier. Toute entrée dans un salon d'équipe
revérifie les droits en base. Un service annonce via `RealtimeNotifier`, `src/realtime/socketIoNotifier.ts` émet.

Pagination (cours 1.10) : toute collection qui peut grossir prend `paginationQuery` et renvoie `pagination`.
Les collections bornées (8 équipes, 5 membres, 7 matchs) peuvent être embarquées sans pagination.

## Règle de test (imposée par le sujet)

Pour **chaque** règle d'accès, un test qui prouve que l'utilisateur **non autorisé est refusé**, pas seulement que
l'autorisé passe. `tests/hardening.test.ts` vérifie que toute route non publique renvoie 401 sans jeton et toute route
admin 403 à un joueur. Règles métier : tests unitaires sans base dans `tests/unit/`.
Toute avancée = `npm test` + `npm run typecheck` verts avant de la déclarer finie.
`tests/context.ts` recrée l'application avant chaque test ; `tests/setup.ts` vide les tables (enfants avant parents) :
y ajouter chaque nouvelle table. Fixtures rapides dans `tests/helpers.ts` (`quickUser`, `createTeam`, `closedTournament`...).

## Avancement des exigences

Légende : [x] fait et testé côté API · [ ] à faire.

- [x] Socle : auth (JWT HS256, bcrypt, freinage par compte, mots de passe connus refusés), jeux, erreurs centralisées
- [x] B-01 à B-04 Tournois : création, recherche paginée, clôture, lancement (forfait si < 5 joueurs ou joueur sans rôle)
- [x] B-05 à B-11 Équipes : création, demandes, départ, 5 joueurs avec rôle, actions du capitaine, gel après clôture
- [x] B-12 à B-15 Compétition : arbre tiré au sort, résultats, progression, forfaits
- [x] B-16 à B-18 Chat : réservé aux membres, temps réel, exclusion immédiate, fermé après élimination sauf pour l'admin
- [x] B-19 Suivi en direct (`tournament:updated`, `match:updated`)
- [x] Besoins du front (`BACK-ATTENDU.md` du dépôt front, hors barème B-xx) : non-lus (`/api/me/unread`), demandes
  en temps réel (`joinRequest:new/updated`), `/api/me/join-requests`, `/api/me/teams`, `/api/users/:id/stats`,
  `registrationClosesAt`, `scheduledAt`, `visibility` d'équipe. Colonnes ajoutées après coup : `ADDED_COLUMNS`
  dans `database.ts` (migration des bases existantes).
- [x] Équipes hors tournoi (`BACK-ATTENDU.md` § 7) : `POST /api/teams`, `GET /api/teams?free=true`,
  `POST /api/teams/:id/register`. `teams.tournament_id` nullable et `teams.game_id` : `migrateFreeTeams` dans
  `database.ts` reconstruit les tables des bases existantes.

- [x] Paris en Écus des spectateurs (`BACK-ATTENDU.md` de `feat/paris`, hors barème) : portefeuille, pari mutuel
  match par match, réglé dans la transaction du résultat (port `BetSettlement` de `MatchService`), classements
  tournoi et semaine, `bets:updated` / `wallet:updated`. Remplace les pronostics d'arbre (retirés, commit 3cd657f).

Règles de gestion choisies : fin de `api-routes.md`.

## Livrables hors code (notés)

- [x] Journalisation conforme au cours (JSON Lines, champs nommés, request_id propagé, 500 avec pile à part)
- [x] Doc développeur (`README.md`), doc d'API générée (`/docs`) + `api-routes.md`
- [ ] Fiches de décision dans `docs/adr/` : squelettes avec les faits, **rédaction à faire par le binôme**
- [ ] Front React (repo séparé) : espace joueur branché sur l'API, à finir
- [ ] Rapport sur l'usage de l'IA (un par équipe, écrit avec nos mots, pas d'« AI slop »)
- [ ] SQLite → PostgreSQL (cf. commit d2f0edf) : à trancher dans la fiche 0001

Barème : la note est multipliée par la part des exigences B-01..B-19 livrées. Toutes comptent.
