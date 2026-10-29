# Ce que le back attend du front

Réponse au `BACK-ATTENDU.md` du dépôt FRONT : les sept points sont livrés côté back (le 7e : équipes hors tournoi). Ce fichier liste ce que
le front doit changer pour les utiliser et retirer ses contournements. Le détail des routes est dans
`api-routes.md` et sur `/docs` (OpenAPI générée depuis le code).

Rien n'a été retiré ni renommé : le front actuel continue de fonctionner tel quel. Les réponses ont seulement
des champs en plus.

## 0. Types (`src/services/dto.ts`)

| Type | Champ ajouté |
|---|---|
| `TournamentDto` | `registrationClosesAt: string \| null` |
| `MatchDto` | `scheduledAt: string \| null` |
| `TeamDto` | `visibility: 'open' \| 'private'` |
| `JoinRequestDto` | `tournamentId: number`, `team: { id: number; name: string }` |

Nouveaux événements dans `ServerEvents` (`src/services/realtime.ts`) :

```ts
'joinRequest:new': (request: JoinRequestDto) => void      // reçu par le capitaine
'joinRequest:updated': (request: JoinRequestDto) => void  // reçu par l'auteur de la demande
```

Ils arrivent dans le salon personnel du joueur, rejoint automatiquement à la connexion avec un token :
aucun `*:join` à émettre.

## 1. Messages lus / non lus

```
GET  /api/me/unread                          → 200 { teams: [{ teamId, unread, lastReadMessageId }] }
POST /api/teams/:id/messages/read { messageId } → 204
```

- Remplacer `src/services/readMarkers.ts` (localStorage) par ces deux routes ; adapter `NotificationsProvider.tsx`.
- Appeler `messages/read` avec l'id du message le plus récent affiché quand le chat est ouvert.
- Le repère ne recule jamais : renvoyer un id plus ancien ne fait rien.
- `lastReadMessageId: null` : jamais lu, tous les messages des autres comptent comme non lus.
- Erreurs : `403 NOT_TEAM_MEMBER`, `404 MESSAGE_NOT_FOUND` (message d'une autre équipe).

## 2. Demandes d'adhésion en temps réel

- Capitaine : sur `joinRequest:new`, mettre à jour le badge sans attendre un changement de page.
- Auteur : sur `joinRequest:updated`, mettre à jour l'état de sa demande. `status` vaut `accepted`, `rejected`
  (refus du capitaine **ou** clôture du tournoi : le back rejette, il n'annule pas) ou `cancelled` (annulée par
  le joueur, ou parce qu'il est entré dans une autre équipe du tournoi).

## 3. Mes demandes

```
GET /api/me/join-requests?status=pending → 200 { joinRequests: JoinRequestDto[], pagination }
```

- Remplacer `src/services/requestStorage.ts` ; adapter `TournamentsProvider.tsx`.
- Réponse paginée (règle du cours) : `?limit=` (défaut 20, max 100) et `?offset=`.

## 4. Mes équipes

```
GET /api/me/teams → 200 { teams: [TeamDto & { tournament: TournamentDto }], pagination }
```

- Remplace la boucle « un `GET /api/tournaments/:id` par tournoi » dans `src/services/tournaments.ts`.
- Paginée, les plus récentes d'abord.

## 5. Statistiques du profil

```
GET /api/users/:id/stats → 200 {
  tournaments, matchesPlayed, matchesWon, titles,
  history: [{ tournament: { id, name, game: { id, name } }, finishedAt,
              result: 'champion' | 'final' | 'semi' | 'quarter' }],
  pagination
}
```

- Remplace le calcul de `src/utils/profile.ts`. Route publique ; `404 USER_NOT_FOUND`.
- `tournaments` compte les tournois lancés ou terminés ; `history` ne garde que les terminés (paginé).
- Un match perdu par forfait compte comme joué.

## 6. Données de la maquette

| Donnée | Lecture | Écriture |
|---|---|---|
| `registrationClosesAt` | `TournamentDto` | Admin : à la création (`POST /api/tournaments`) ou `PATCH /api/tournaments/:id`, tant que les inscriptions sont ouvertes |
| `scheduledAt` | `MatchDto` | Admin : `PATCH /api/matches/:id { scheduledAt }`, refusé sur un match joué (`409`) |
| `visibility` | `TeamDto` | Capitaine : `PATCH /api/teams/:id { visibility: 'private' }` |

- Dates envoyées en ISO 8601 **avec fuseau** (`2026-12-01T18:00:00+01:00` ou `...Z`), renvoyées en UTC. `null` efface.
- Les deux dates sont indicatives : la clôture et les résultats restent des actions de l'admin.
- Équipe privée : les nouvelles demandes sont refusées (`409 TEAM_PRIVATE`) ; griser le bouton « Demander à
  rejoindre ». Les demandes déjà en attente restent acceptables par le capitaine.
- `PATCH /api/teams/:id` accepte `name`, `visibility` ou les deux ; un corps vide est refusé (`400`).

## 7. Équipes hors tournoi

```
POST /api/teams  { name, gameId }             → 201 { team }   (connecté, devient capitaine)
GET  /api/teams?free=true&search=             → 200 { teams: TeamDto[], pagination }   (public)
POST /api/teams/:id/register { tournamentId } → 200 { team }   (capitaine)
```

- Rien à changer dans `src/services/teams.ts` : les routes ont la forme attendue.
- `TeamDto` a toujours `game: { id, name }` (celui du tournoi pour une équipe inscrite) ; le champ peut
  passer d'optionnel à obligatoire dans `dto.ts`.
- `tournamentId` vaut `null` hors tournoi, dans `TeamDto` comme dans `JoinRequestDto` ; `GET /api/me/teams`
  renvoie `tournament: null` pour ces équipes. `GET /api/teams` sans `free` liste toutes les équipes,
  `free=false` seulement les inscrites.
- Hors tournoi, un joueur peut être dans plusieurs équipes ; l'unicité par tournoi ne joue qu'à l'inscription
  (`409 MEMBER_ALREADY_IN_TOURNAMENT`). Le nom n'est unique qu'au sein d'un tournoi.
- À l'inscription, les demandes en attente **des membres** vers d'autres équipes du tournoi sont annulées
  (`joinRequest:updated`), comme à la création d'une équipe ; `team:updated` et `tournament:updated` sont émis.
- Ordre des erreurs de `register` : `404` (équipe, tournoi), `403 NOT_TEAM_MEMBER / NOT_CAPTAIN`, puis
  `409 TEAM_ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `GAME_MISMATCH`, `TOURNAMENT_FULL`,
  `MEMBER_ALREADY_IN_TOURNAMENT`, `TEAM_NAME_TAKEN`.

## Rappel de configuration

`CORS_ORIGIN` du `.env` du back doit contenir l'origine du front (`http://localhost:5173` en dev).
