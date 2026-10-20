# R5A5_2026_SUJETB_AUSOUSSEAU_PEREIRA_BACK
Plateforme de tournois

## Techno
Express.js v5.2.1, TypeScript (tsx), SQLite (better-sqlite3), Zod, Vitest.
Authentification : jsonwebtoken (HS256), argon2 (argon2id), express-rate-limit, cookie-parser.

## Démarrage

```bash
npm ci
cp .env.example .env      # puis remplir JWT_SECRET (voir ci-dessous)
npm run migrate           # crée / met à jour le schéma
npm run seed:admin        # optionnel : crée un compte admin (ADMIN_*)
npm run dev               # http://localhost:3000
npm test                  # suite de tests (base en mémoire)
```

En production : `NODE_ENV=production npm start` (les migrations en attente sont appliquées au démarrage).

## Variables d'environnement

Tous les secrets viennent de l'environnement, jamais du code. `.env` est ignoré par git ; `.env.example`
est versionné **sans valeur secrète**. L'application **refuse de démarrer** si une valeur est manquante
ou dangereuse (le message nomme la variable, jamais sa valeur).

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `NODE_ENV` | | `development` | `production` active les contrôles stricts ci-dessous |
| `PORT` | | `3000` | |
| `DB_PATH` | | `data/arch-rivals.db` | fichier SQLite |
| `JWT_SECRET` | **oui** | | clé de signature HS256, ≥ 32 octets aléatoires : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGINS` | **oui en prod** | `http://localhost:5173` hors prod | origines du front, séparées par des virgules, `https://` en prod |
| `COOKIE_SECURE` | | `true` | `false` uniquement en dev local (refusé en prod) |
| `COOKIE_SAMESITE` | | `none` | `none` (deux domaines, exige Secure), `lax` en dev local |
| `COOKIE_DOMAIN` | | vide | vide = domaine exact de l'API (recommandé) |
| `TRUST_PROXY` | | vide | nombre de reverse proxies devant l'API (IP réelle, HTTPS) |
| `FORCE_HTTPS` | | `true` en prod | redirige HTTP → HTTPS (308) en lecture, refuse les écritures |
| `DEBUG` | | `false` | détail des erreurs 500 dans la réponse ; **refusé en prod** |
| `RATE_LIMIT_GLOBAL_PER_MIN` | | `100` | par IP, toutes routes |
| `RATE_LIMIT_LOGIN_PER_MIN` | | `5` | par IP |
| `RATE_LIMIT_REGISTER_PER_MIN` | | `5` | par IP |
| `RATE_LIMIT_REFRESH_PER_MIN` | | `10` | par IP |
| `RATE_LIMIT_CSRF_PER_MIN` | | `30` | par IP |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | pour `seed:admin` | | compte admin initial |

Dev local (front `localhost:5173`, API `localhost:3000`, même site) : `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax`.

## Migrations

`sql/schema.sqlite.sql` est le schéma de départ ; les évolutions sont dans `sql/migrations/NNN_nom.up.sql`
et `NNN_nom.down.sql`, appliquées une seule fois (table `schema_migrations`).

```bash
npm run migrate            # applique les migrations en attente
npm run migrate:rollback   # annule la dernière (ex. 002_auth)
```

`002_auth` ajoute `users.public_id` (UUID), `users.token_version`, un index unique sur `lower(email)` et
les tables `refresh_tokens` et `login_failures`. Elle ne modifie aucune colonne existante (`is_admin`
reste la source du rôle). Les mots de passe bcrypt existants sont rehachés en argon2id au prochain login réussi.

## Authentification

Contrat détaillé : [`api-routes.md`](api-routes.md). Intégration côté React : [`docs/FRONT-INTEGRATION.md`](docs/FRONT-INTEGRATION.md).

| Méthode | Route | Accès | Réponse |
|---|---|---|---|
| GET | `/api/auth/csrf` | Public | `{ csrfToken }` + cookie `csrf` |
| POST | `/api/auth/register` | Public + CSRF | 201 `{ accessToken, expiresIn, user }` + cookie refresh |
| POST | `/api/auth/login` | Public + CSRF | 200 `{ accessToken, expiresIn, user }` + cookie refresh |
| POST | `/api/auth/refresh` | Cookie refresh + CSRF | 200 `{ accessToken, expiresIn, user }` + nouveau cookie refresh |
| POST | `/api/auth/logout` | Cookie refresh + CSRF | 204, refresh révoqué, cookie supprimé |
| GET | `/api/auth/me` | Access token | `{ user }` |

### Jetons
- **Access token** : JWT HS256, 15 min, envoyé dans `Authorization: Bearer …`. Claims : `sub` (UUID public),
  `iat`, `nbf`, `exp`, `jti`, `type: "access"`, `role`, `ver` (= `token_version`).
- **Refresh token** : JWT HS256, 30 jours, uniquement dans le cookie `refresh_token`
  (`HttpOnly; Secure; SameSite=None; Path=/api/auth; Max-Age=2592000`). Seul son `jti` est stocké en base.
- L'algorithme est imposé côté serveur (`alg` du header jamais pris en compte, `none` refusé).

### Flux
1. **Login** : `GET /api/auth/csrf` → `POST /api/auth/login` avec `X-CSRF-Token`. L'access token est gardé
   **en mémoire** par le front ; le refresh token est en cookie HttpOnly.
2. **Refresh avec rotation** : `POST /api/auth/refresh` (cookie envoyé automatiquement, `credentials: 'include'`).
   L'ancien `jti` est révoqué, un nouveau refresh de la même famille est émis. **Rejouer un refresh déjà
   révoqué** révoque toutes les sessions de l'utilisateur et invalide ses access tokens.
3. **Logout** : `POST /api/auth/logout` révoque le `jti` et supprime le cookie.
4. **Invalidation** : un changement de mot de passe ou de rôle incrémente `token_version` ; tout jeton
   émis avant est refusé (401 `TOKEN_REVOKED`).

### Protections
- Refus par défaut : un garde global exige un access token sur toutes les routes, sauf la liste blanche
  `src/security/publicRoutes.ts` (vérifiée par `tests/routes.test.ts`). Rôles : `requireRole('admin')` (403).
  Propriété : vérifiée dans le use case, `AccessDenied` → 403 (`src/policies/`).
- CSRF : double-submit (`csrf` + `X-CSRF-Token`, comparaison en temps constant) sur toutes les méthodes
  non sûres, login et register compris ; `Origin` vérifié en plus.
- Login : même réponse « Identifiants invalides » (401) pour un email inconnu et un mauvais mot de passe ;
  5/min par IP ; délai par compte qui double à chaque échec (1 s, 2 s, 4 s… plafonné à 15 min, 429 + `Retry-After`),
  sans blocage à durée fixe.
- Mots de passe : argon2id, 12 à 256 caractères, aucun jeu de caractères imposé, refus des mots de passe
  connus des fuites (liste locale `src/security/common-passwords.txt`, issue de SecLists, licence MIT).
- Entrées : schémas Zod stricts (champ inconnu → 400), JSON obligatoire (415), 100 ko maximum (413).
- Réponses : JSON uniquement, headers de sécurité, pas de `X-Powered-By`, erreurs 500 génériques avec
  `requestId` (détail dans les logs), projection explicite des utilisateurs.

> En production réelle, on brancherait plutôt un fournisseur d'identité (Keycloak, Entra ID, Auth0, Okta).
> Ici le mécanisme est implémenté à la main pour le comprendre.

## Rotation de la clé de signature JWT

À faire immédiatement si la clé a pu fuiter (commit, log, poste compromis), sinon périodiquement.
**Remplacer `JWT_SECRET` déconnecte tout le monde** : tous les access et refresh tokens deviennent invalides
(401), chaque utilisateur doit se reconnecter.

1. Générer une nouvelle clé : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
2. La renseigner dans le gestionnaire de secrets de l'hébergeur (jamais dans le dépôt ni dans un ticket).
3. Redémarrer toutes les instances de l'API.
4. Optionnel : vider les refresh tokens devenus inutiles : `DELETE FROM refresh_tokens;`.
5. Si la clé a fuité dans git : la considérer comme compromise même après suppression du fichier ; la
   rotation ci-dessus est la seule vraie réponse (réécrire l'historique ne suffit pas).

## Déploiement et retour arrière

- Derrière un reverse proxy HTTPS (certificats à jour, redirection HTTP → HTTPS) avec `TRUST_PROXY=1`,
  `NODE_ENV=production`, `CORS_ORIGINS=https://<front>`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`.
- Limites de débit en mémoire : avec plusieurs instances, utiliser un store partagé (Redis).
- La CI (`.github/workflows/ci.yml`) lance typecheck, tests, `npm audit` et gitleaks à chaque intégration.

**Retour arrière rapide** (version N cassée, retour à N-1) :
1. Sauvegarder la base : `cp data/arch-rivals.db data/arch-rivals.db.bak-$(date +%F-%H%M)`.
2. Si la version N a ajouté une migration, l'annuler **avec le code de N** : `npm run migrate:rollback`
   (une fois par migration ajoutée).
3. Redéployer le commit ou le tag N-1 : `git checkout <tag-N-1> && npm ci && npm start`.
4. Vérifier `GET /api/health`, puis un login.

Cas particulier, revenir **avant cette branche d'authentification** : le rollback de `002_auth` supprime
les sessions et le compteur d'échecs, mais conserve les utilisateurs. En revanche, l'ancienne version ne
sait vérifier que bcrypt : les comptes déjà rehachés en argon2id ne pourraient plus se connecter avec elle
(prévoir une réinitialisation de leur mot de passe).
