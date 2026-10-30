# Arch Rivals : API

API de la plateforme de tournois de l'association étudiante (R5A5, sujet B) : équipes de cinq, arbre à huit équipes,
chat d'équipe et suivi des tournois en temps réel. Elle est appelée par le front React
(dépôt `R5A5_2026_SUJETB_AUSOUSSEAU_PEREIRA_FRONT`) et ne dépend d'aucun service externe : la base SQLite est un fichier local.

## Prérequis

- Node.js 24 (testé avec 24.19) et npm 11
- Aucune autre installation : le binaire SQLite précompilé est fourni par le paquet `better-sqlite3`

## Démarrage

```bash
npm ci                    # .npmrc désactive les scripts d'installation : pas besoin de Visual Studio ni de Python
cp .env.example .env      # renseigner JWT_SECRET et ADMIN_PASSWORD (voir les commentaires du fichier)
npm run seed:admin        # crée le compte administrateur décrit dans .env
npm start                 # API + Socket.IO sur http://localhost:3000
```

La base est créée au premier lancement (`data/arch-rivals.db`, schéma `sql/schema.sqlite.sql`).
Aucune route ne crée d'administrateur : seul `seed:admin` le fait.

La documentation d'API interactive est servie sur http://localhost:3000/docs (description brute : `/openapi.json`).

## Tests

```bash
npm test                  # base en mémoire : n'écrit jamais dans data/
npm run typecheck
```

Les tests de `tests/` couvrent surtout les droits d'accès : pour chaque règle, un utilisateur non autorisé doit être refusé.
`tests/unit/` teste les règles métier et un use case sans base de données.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur avec rechargement à chaud |
| `npm start` | Serveur (TypeScript exécuté par `tsx`, pas d'étape de build) |
| `npm test` | Tests |
| `npm run typecheck` | Vérification TypeScript |
| `npm run seed:admin` | Création de l'administrateur |

## Structure

Clean Architecture, un dossier par fonctionnalité. Les dépendances vont vers l'intérieur :
`infrastructure` → `application` → `domain`, et un fichier de `domain/` n'importe ni framework, ni base, ni bibliothèque HTTP.

| Dossier | Contenu |
|---|---|
| `src/features/<fonctionnalité>/domain/` | Entités et règles métier (arbre, équipe, droits sur le chat), sans dépendance externe |
| `src/features/<fonctionnalité>/application/` | Use cases (services) et interfaces dont ils dépendent (`ports.ts`) |
| `src/features/<fonctionnalité>/infrastructure/` | Repositories SQLite, adaptateurs (bcrypt, JWT), routes HTTP avec leurs DTO zod et mappers |
| `src/shared/` | Erreurs métier, ports communs (logger, transactions, temps réel), infrastructure HTTP commune |
| `src/realtime/` | Serveur Socket.IO et implémentation du port de notification temps réel |
| `src/container.ts` | Composition root : assemble les implémentations concrètes |
| `src/app.ts`, `src/server.ts` | Application Express, démarrage et arrêt progressif |

Fonctionnalités : `users` (authentification), `games`, `tournaments` (tournois, arbre, matchs), `teams` (équipes, demandes d'adhésion), `chat`, `bets` (paris en Écus des spectateurs).

Une route se déclare une seule fois (`route({...})` dans `infrastructure/http.ts`) : la même déclaration fixe les droits
d'accès (`public`, `authenticated`, `admin`), valide les entrées et produit la documentation OpenAPI.

## Journalisation

JSON Lines sur la sortie standard : une ligne par requête (`request_completed`, `request_rejected`, `request_failed`) avec
`timestamp`, `level`, `method`, `path`, `route`, `status`, `duration_ms`, `size_bytes`, `user`, `request_id`, et
`exception` / `error` en cas d'erreur. Les événements métier (`tournament_closed`, `match_result_recorded`, `login_failed`...)
portent le même `request_id`. Ni mot de passe, ni jeton, ni email, ni adresse IP.
Seuil réglable par `LOG_LEVEL`. Pour lire les logs en développement : `npm run dev | npx pino-pretty`.

## Aller plus loin

- [Contrat d'API : droits, temps réel, règles de gestion](api-routes.md)
- [Décisions d'architecture](docs/adr/)
- [Conventions du projet pour les agents IA](CLAUDE.md)
