# Arch Rivals : contrat d'API

> **Référence détaillée** : la description OpenAPI est générée depuis le code (schémas de validation compris) et servie sur
> `/docs` (Swagger UI) et `/openapi.json`. Ce fichier donne la vue d'ensemble, les droits, le temps réel et les règles de gestion.

## Conventions

- Toutes les routes sont préfixées par `/api` et échangent du JSON (`Content-Type: application/json`, sinon `415`).
- Authentification : header `Authorization: Bearer <token>`.
- Dates au format ISO 8601 (UTC), identifiants numériques.
- Les champs inconnus dans un corps de requête sont refusés (`400`).
- Les collections qui peuvent grossir sont paginées : `?limit=` (défaut 20, max 100) et `?offset=`. Réponse : `{ "<liste>": [...], "pagination": { "limit", "offset", "total" } }`.
- Format d'erreur unique : `{ "error": { "code": "TEAM_FULL", "message": "L'équipe est complète" } }`
- Codes HTTP :
  - `400` requête illisible : JSON cassé, champ manquant, mauvais type, champ inconnu (`VALIDATION_ERROR`, avec `details`)
  - `401` non connecté, jeton invalide ou expiré
  - `403` connecté mais pas autorisé
  - `404` ressource introuvable
  - `409` conflit avec l'état actuel (équipe complète, inscriptions closes...)
  - `413` corps de plus de 100 ko, `415` corps qui n'est pas du JSON
  - `422` valeurs lisibles mais incohérentes entre elles (rôle d'un autre jeu, match nul, rôles en double...)
  - `429` trop de requêtes (`RATE_LIMITED`) ou trop d'échecs de connexion sur un compte (`TOO_MANY_ATTEMPTS`, header `Retry-After`)
  - `500` erreur interne, message générique ; le détail est dans les logs, retrouvable par le header `X-Request-Id`

## Authentification

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Créer un compte |
| POST | `/api/auth/login` | Public | Se connecter, renvoie un token |
| GET | `/api/auth/me` | Connecté | Infos de l'utilisateur connecté |

## Jeux

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/games` | Public | Liste des jeux et de leurs rôles |
| POST | `/api/games` | Admin | Créer un jeu avec ses rôles |

## Tournois

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| GET | `/api/tournaments?search=&status=` | Public | B-02 | Rechercher des tournois |
| GET | `/api/tournaments/:id` | Public | B-02, B-19 | Détail complet : tournoi, équipes avec membres, arbre |
| POST | `/api/tournaments` | Admin | B-01 | Créer un tournoi (inscriptions ouvertes), avec une date de clôture prévue facultative |
| PATCH | `/api/tournaments/:id` | Admin | | Changer la date de clôture prévue (`registrationClosesAt`), tant que les inscriptions sont ouvertes |
| POST | `/api/tournaments/:id/close` | Admin | B-03, B-12 | Clore les inscriptions et générer l'arbre |
| POST | `/api/tournaments/:id/start` | Admin | B-04 | Lancer le tournoi, forfaits des équipes incomplètes |
| GET | `/api/tournaments/:id/matches` | Public | B-02, B-19 | Arbre du tournoi |

Pendant les inscriptions, `matches` est un tableau vide. Aucune donnée privée (email, messages) dans les routes publiques.

## Équipes

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| GET | `/api/tournaments/:id/teams` | Public | B-06 | Chercher une équipe dans un tournoi |
| POST | `/api/tournaments/:id/teams` | Connecté, sans équipe dans ce tournoi | B-05, B-07 | Créer une équipe et en devenir capitaine |
| GET | `/api/teams/:id` | Public | | Détail d'une équipe |
| PATCH | `/api/teams/:id` | Capitaine | B-09 | Renommer l'équipe (`name`), l'ouvrir ou la fermer aux demandes (`visibility`: `open` / `private`) |
| GET | `/api/me/teams` | Connecté | | Mes équipes, chacune avec son tournoi (paginé) |
| DELETE | `/api/teams/:id` | Capitaine | B-10 | Supprimer l'équipe (membres, demandes et messages supprimés en cascade) |
| POST | `/api/teams/:id/transfer-captaincy` | Capitaine | B-09 | Passer la main à un membre |
| PATCH | `/api/teams/:id/members/:userId` | Capitaine | B-08, B-09 | Attribuer un rôle de jeu |
| DELETE | `/api/teams/:id/members/:userId` | Capitaine | B-09, B-17 | Exclure un membre |
| DELETE | `/api/teams/:id/members/me` | Membre (capitaine compris) | B-06 | Quitter l'équipe |

Règles :

- Toute modification d'équipe est refusée (`409`) si les inscriptions ne sont plus ouvertes (B-11).
- Si le capitaine quitte l'équipe, le membre arrivé le plus tôt devient capitaine (départage par `user_id` en cas d'égalité).
- Si le capitaine était seul, l'équipe est supprimée.

## Demandes d'adhésion

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| POST | `/api/teams/:id/join-requests` | Connecté, sans équipe dans ce tournoi | B-06, B-07 | Demander à rejoindre une équipe |
| GET | `/api/teams/:id/join-requests` | Capitaine | B-10 | Voir les demandes en attente |
| POST | `/api/join-requests/:id/accept` | Capitaine | B-08, B-10 | Accepter (refusé si l'équipe a déjà 5 membres) |
| POST | `/api/join-requests/:id/reject` | Capitaine | B-10 | Refuser |
| DELETE | `/api/join-requests/:id` | Auteur de la demande | | Annuler sa demande |
| GET | `/api/me/join-requests?status=` | Connecté | | Mes demandes, filtrables par statut (paginé) |

Une demande renvoie aussi `tournamentId` et `team: { id, name }`. Une équipe privée refuse les nouvelles demandes (`409 TEAM_PRIVATE`).

## Matchs

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| POST | `/api/matches/:id/result` | Admin | B-13, B-14 | Saisir le résultat, le gagnant avance |
| POST | `/api/matches/:id/forfeit` | Admin | B-15 | Déclarer une équipe forfait, l'adversaire est qualifié |
| PATCH | `/api/matches/:id` | Admin | | Fixer l'horaire prévu (`scheduledAt`, `null` l'efface), pas sur un match joué |

Un match n'est jouable que si ses deux équipes sont connues (statut `ready`).

## Chat d'équipe

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| GET | `/api/teams/:id/messages` | Membre, ou admin | B-16, B-18 | Historique des messages |
| POST | `/api/teams/:id/messages` | Membre, équipe non éliminée | B-16, B-18 | Envoyer un message |
| POST | `/api/teams/:id/messages/read` | Membre | | Marquer lu jusqu'à `messageId` ; le repère ne recule jamais |
| GET | `/api/me/unread` | Connecté | | `{ teams: [{ teamId, unread, lastReadMessageId }] }` pour mes équipes encore en lice |

`unread` compte les messages des autres membres plus récents que le repère (tous, si `lastReadMessageId` est `null`).

## Profil

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/users/:id/stats` | Public | Tournois joués, matchs joués et gagnés, titres ; `history` paginé des tournois terminés avec le résultat (`champion`, `final`, `semi`, `quarter`) |

## Événements temps réel

| Événement | Destinataires | Déclencheur |
|---|---|---|
| `tournament:updated` | Tous ceux qui consultent le tournoi | Changement d'état, nouvelle équipe, résultat |
| `match:updated` | Tous ceux qui consultent le tournoi | Résultat saisi, forfait |
| `team:updated` | Membres de l'équipe | Membre ajouté, parti, rôle modifié, nouveau capitaine |
| `message:new` | Membres de l'équipe | Nouveau message |
| `member:kicked` | Le joueur exclu | Exclusion, le front le sort du chat |
| `team:deleted` | Membres de l'équipe | Le capitaine a supprimé l'équipe |
| `session:expired` | Le client concerné | Jeton expiré, la connexion va être fermée |
| `joinRequest:new` | Le capitaine de l'équipe | Nouvelle demande d'adhésion |
| `joinRequest:updated` | L'auteur de la demande | Acceptée, refusée, rejetée à la clôture, annulée (par lui, ou parce qu'il est entré dans une autre équipe) |

Les événements destinés à un joueur précis passent par son salon personnel, rejoint automatiquement à la connexion avec un token.

### Connexion Socket.IO

Même origine que l'API. Le token est facultatif : sans token, on est visiteur.

```ts
const socket = io('http://localhost:3000', { auth: { token } });
await socket.emitWithAck('tournament:join', tournamentId); // { ok: true }, ouvert à tous
await socket.emitWithAck('team:join', teamId);             // { ok: true } ou { error: { code, message } }
socket.emit('tournament:leave', tournamentId);
socket.emit('team:leave', teamId);
```

- Token invalide ou expiré : connexion refusée, `connect_error` avec le code (`INVALID_TOKEN`, `TOKEN_EXPIRED`).
- `team:join` applique les mêmes droits que `GET /api/teams/:id/messages` : membre d'une équipe non éliminée, ou admin.
- Un membre exclu, parti, ou dont l'équipe est éliminée/supprimée est retiré du salon côté serveur : il ne reçoit plus rien.
- Le jeton n'est vérifié qu'à la connexion : à son expiration, le serveur envoie `session:expired` puis ferme la connexion. Le client se reconnecte avec un jeton neuf.
- Après une reconnexion, le serveur voit une nouvelle connexion : le client renvoie ses `tournament:join` / `team:join` à chaque événement `connect`.
- Une connexion depuis une origine absente de `CORS_ORIGIN` est refusée (les WebSockets échappent au CORS du navigateur).
- Les écritures passent toujours par HTTP ; le canal temps réel ne fait que notifier.

## Règles de gestion retenues

- Un tournoi accepte au plus 8 équipes ; la clôture exige exactement 8 équipes (`409 NOT_ENOUGH_TEAMS`). L'arbre est tiré au sort.
- À la clôture, les demandes d'adhésion en attente sont rejetées.
- Entrer dans une équipe (création ou demande acceptée) annule ses autres demandes en attente dans le tournoi.
- Au lancement, une équipe est incomplète si elle a moins de 5 joueurs **ou** si un joueur n'a pas de rôle (B-08) : elle perd son premier match par forfait. Si les deux équipes d'un quart sont incomplètes, la plus fournie passe (égalité : la plus ancienne). À faire valider par le commanditaire.
- Chat d'une équipe éliminée : fermé en lecture et en écriture pour les membres (`409 TEAM_CHAT_CLOSED`), lisible par l'admin. L'admin ne peut écrire que dans une équipe dont il est membre.
- Le chat est renvoyé du message le plus récent au plus ancien, paginé.
- `registrationClosesAt` et `scheduledAt` sont indicatifs : la clôture et les résultats restent des actions de l'admin.
- Une équipe privée garde ses demandes déjà en attente : le capitaine peut encore les accepter.
- Connexion : après chaque échec sur un compte, le compte attend 1 s, puis 2 s, 4 s... (15 min au plus) avant un nouvel essai. Un succès remet le compteur à zéro.
- Mots de passe : 8 caractères au moins, 72 octets au plus (limite de bcrypt), et les mots de passe les plus fréquents des fuites sont refusés.
