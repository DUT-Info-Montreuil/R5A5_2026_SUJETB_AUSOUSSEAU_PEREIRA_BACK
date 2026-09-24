# Arch Rivals : contrat d'API

## Conventions

- Toutes les routes sont préfixées par `/api` et échangent du JSON.
- Authentification : header `Authorization: Bearer <token>`.
- Dates au format ISO 8601 (UTC), identifiants numériques.
- Format d'erreur unique : `{ "error": { "code": "TEAM_FULL", "message": "L'équipe est complète" } }`
- Codes HTTP :
  - `400` données invalides
  - `401` non connecté
  - `403` connecté mais pas autorisé
  - `404` ressource introuvable
  - `409` conflit avec l'état actuel (équipe complète, inscriptions closes...)

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
| POST | `/api/tournaments` | Admin | B-01 | Créer un tournoi (inscriptions ouvertes) |
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
| PATCH | `/api/teams/:id` | Capitaine | B-09 | Renommer l'équipe |
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

## Matchs

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| POST | `/api/matches/:id/result` | Admin | B-13, B-14 | Saisir le résultat, le gagnant avance |
| POST | `/api/matches/:id/forfeit` | Admin | B-15 | Déclarer une équipe forfait, l'adversaire est qualifié |

Un match n'est jouable que si ses deux équipes sont connues (statut `ready`).

## Chat d'équipe

| Méthode | Route | Accès | Exigences | Description |
|---|---|---|---|---|
| GET | `/api/teams/:id/messages` | Membre, ou admin | B-16, B-18 | Historique des messages |
| POST | `/api/teams/:id/messages` | Membre, équipe non éliminée | B-16, B-18 | Envoyer un message |

## Événements temps réel

| Événement | Destinataires | Déclencheur |
|---|---|---|
| `tournament:updated` | Tous ceux qui consultent le tournoi | Changement d'état, nouvelle équipe, résultat |
| `match:updated` | Tous ceux qui consultent le tournoi | Résultat saisi, forfait |
| `team:updated` | Membres de l'équipe | Membre ajouté, parti, rôle modifié, nouveau capitaine |
| `message:new` | Membres de l'équipe | Nouveau message |
| `member:kicked` | Le joueur exclu | Exclusion, le front le sort du chat |
