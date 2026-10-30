# Ce que le back attend du front

Réponse au `BACK-ATTENDU.md` du dépôt FRONT : les sept points sont livrés côté back (le 7e : équipes hors tournoi), et le back propose en plus des pronostics pour les spectateurs (§ 9, à construire côté front). Ce fichier liste ce que
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

## 8. Anomalie de suppression d'une équipe hors tournoi : corrigée

- `DELETE /api/teams/:id` supprime maintenant les membres explicitement (la clé étrangère composite n'est pas
  vérifiée par SQLite quand `tournament_id` est NULL). Demandes et messages partaient déjà en cascade.
- Au démarrage, le back purge les membres orphelins laissés avant le correctif : rien à nettoyer à la main.
- Le départ du dernier membre n'était pas touché (le membre est retiré avant l'équipe).

## 9. Pronostics des spectateurs (nouveau, à construire)

Fonctionnalité ajoutée côté back pour donner un intérêt au visiteur : il pronostique tout l'arbre d'un tournoi,
gagne des points au fil des résultats et se compare aux autres. Rien n'existe encore côté front.

### Quand et qui

- Ouvert **seulement** quand le tournoi est `registration_closed` (l'arbre vient d'être tiré, rien n'est joué).
  Au lancement (`in_progress`), les pronostics sont figés : afficher l'arbre en lecture seule avec les points.
- Il faut être connecté. Un visiteur non connecté voit la répartition et le classement, avec un bouton « Se connecter
  pour pronostiquer ».
- Un joueur d'une équipe du tournoi ne peut pas pronostiquer (`403 PLAYER_CANNOT_PREDICT`) : masquer le formulaire
  pour lui (il est dans `GET /api/me/teams`).

### Routes

```
POST /api/tournaments/:id/predictions { picks: [{ matchId, teamId }] }  → 200 { picks, points, correct }
GET  /api/tournaments/:id/predictions/me                                → 200 { picks, points, correct }
GET  /api/tournaments/:id/predictions                                   → 200 { participants, matches: [{ matchId, picks: [{ teamId, count }] }] }
GET  /api/tournaments/:id/predictions/leaderboard?limit=&offset=        → 200 { leaderboard: [{ rank, user: { id, username }, points, correct }], pagination }
```

Types à ajouter dans `dto.ts` :

```ts
export interface PickDto { matchId: number; teamId: number }
export interface MyPredictionDto { picks: PickDto[]; points: number; correct: number }   // picks vide : rien envoyé
export interface PredictionSummaryDto { participants: number; matches: { matchId: number; picks: { teamId: number; count: number }[] }[] }
export interface StandingDto { rank: number; user: { id: number; username: string }; points: number; correct: number }
```

### Écran à faire : onglet « Pronostics » de la page tournoi

1. **Formulaire d'arbre** (si `registration_closed`, connecté, pas joueur) : les 4 quarts viennent de
   `TournamentDto.matches` (round 1, `teamAId` / `teamBId`). Un clic sur une équipe la fait monter au tour suivant ;
   la demie `position p` reçoit les vainqueurs choisis des quarts `2p-1` et `2p`, la finale ceux des deux demies.
   Changer un quart retire l'équipe éliminée des tours suivants (sinon le back renvoie `422 INVALID_PREDICTION`).
   Bouton « Valider » actif quand les 7 matchs ont un choix ; on peut renvoyer autant de fois qu'on veut avant le
   lancement (le dernier envoi remplace le précédent). Pré-remplir avec `GET .../predictions/me`.
2. **Avis du public** : sur chaque match, barre de pourcentage `count / participants` par équipe (« 62 % voient
   Team A gagner »), et « N pronostiqueurs ». Mettre à jour sur l'événement `predictions:updated` (salon du tournoi,
   même `tournament:join` que le suivi en direct) : la charge utile a la forme de `GET .../predictions` plus `tournamentId`.
3. **Classement** : tableau paginé rang / pseudo / points / bons pronostics, avec ma ligne mise en avant.
   Le recharger sur `tournament:updated` (c'est là que les résultats tombent, et donc les points).
4. **Pendant et après le tournoi** : mon arbre en lecture seule, chaque choix marqué juste / faux / à venir en
   comparant `picks` aux `winnerId` des matchs. Barème à afficher : 1 point par quart, 2 par demie, 4 pour la finale (12 max).

### Erreurs à gérer

| Code | Statut | Affichage |
|---|---|---|
| `PREDICTIONS_CLOSED` | 409 | « Les pronostics sont fermés » (tournoi lancé entre-temps : recharger en lecture seule) |
| `PLAYER_CANNOT_PREDICT` | 403 | Ne devrait pas arriver si le formulaire est masqué pour les joueurs |
| `INVALID_PREDICTION` | 422 | Arbre incomplet ou incohérent : bug du formulaire, afficher le `message` |
| `TOURNAMENT_NOT_FOUND` | 404 | Page 404 habituelle |

## Rappel de configuration

`CORS_ORIGIN` du `.env` du back doit contenir l'origine du front (`http://localhost:5173` en dev).
