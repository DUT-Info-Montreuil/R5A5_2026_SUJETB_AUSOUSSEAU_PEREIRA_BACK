# Rapport : authentification et autorisation du back-end (branche `feat/auth`)

État final : **113 tests sur 113 passent** (départ : 23 sur 23), `tsc` ne signale rien, `npm audit` trouve
0 vulnérabilité, gitleaks ne trouve aucun secret dans l'historique. Hypothèse retenue : front et API sur
**deux domaines** (réponse par défaut, la question est restée sans réponse).

## 1. Fichiers

**Créés**
- Sécurité : `src/security/{tokens,cookies,csrf,password,publicRoutes,securityLog}.ts`,
  `src/security/common-passwords.txt`.
- Middlewares : `src/middlewares/{authenticate,requireRole,rateLimits,originCheck,httpsOnly,requireJson,requestId,securityHeaders}.ts`.
- Métier : `src/errors/AccessDenied.ts`, `src/policies/tournamentPolicy.ts`, `src/services/loginThrottle.ts`.
- Dépôts : `src/repositories/{refreshTokenRepository,loginFailureRepository}.ts`.
- Base : `sql/migrations/002_auth.{up,down}.sql`, `src/scripts/migrate.ts`.
- CI : `.github/workflows/ci.yml`, `.gitleaksignore`.
- Documentation : `docs/FRONT-INTEGRATION.md`, ce rapport.
- 15 fichiers de tests : `tests/{migrations,password,config,hardening,https,tokens,refresh,csrf,login-throttle,rate-limit,account-quota,rbac-idor,routes,data-exposure,cookies-cross-site}.test.ts`.

**Modifiés.** La raison de chaque modification est donnée dans le message de commit correspondant.
- Application : `src/app.ts`, `src/config.ts`, `src/db.ts`, `src/controllers/authController.ts`,
  `src/routes/authRoutes.ts`, `src/services/authService.ts`.
- Dépôts, erreurs, validation : `src/repositories/userRepository.ts`, `src/errors/AppError.ts`,
  `src/middlewares/errorHandler.ts`, `src/validators/authSchemas.ts`.
- Types : `src/types/{user,express.d}.ts`.
- Configuration et documentation : `package.json`, `package-lock.json`, `vitest.config.ts`, `.env.example`,
  `README.md`, `api-routes.md`.

**Supprimés.** `src/middlewares/requireAuth.ts` et `requireAdmin.ts`, remplacés par la garde globale
`authenticate` et par `requireRole`. Il ne reste ainsi qu'un seul point d'entrée par préoccupation.

**Non modifiés.** `sql/schema.sqlite.sql` (schéma de départ), la colonne `is_admin`, `src/scripts/seedAdmin.ts`.

## 2. Checklist : exigence du cours → implémentation

| § | Exigence | Où |
|---|---|---|
| 1 | 401 (pas de jeton, jeton expiré ou invalide), 403 (interdit), 404 (ressource absente) | `tokens.ts`, `authenticate.ts`, `requireRole.ts`, `errorHandler.ts` ; `tests/rbac-idor.test.ts` |
| 1 | Login en POST qui renvoie des jetons, pas de HTTP Basic | `authRoutes.ts`, `authController.ts` |
| 1 | Même message « Identifiants invalides » (401) | `authService.login` ; `tests/auth.test.ts`, `login-throttle.test.ts` |
| 1, 9 | HTTPS : redirection, HSTS, `Secure` | `httpsOnly.ts`, `securityHeaders.ts`, `cookies.ts`, `config.ts` |
| 2.1 | argon2id via bibliothèque, `hashPassword` et `verifyPassword` isolées (`false` en cas d'erreur) | `security/password.ts` |
| 2.1 | Rehachage au login des anciennes empreintes bcrypt | `authService.login`, `needsRehash` ; `tests/password.test.ts` |
| 2.2 | 12 caractères minimum, aucun jeu imposé, maximum 256 (anti-DoS), refus des mots de passe connus des fuites | `validators/authSchemas.ts`, `common-passwords.txt` |
| 2.3 | Limite par IP sur login (5/min), register et refresh | `rateLimits.ts` ; `tests/rate-limit.test.ts` |
| 2.3 | Délai par compte qui double, 429 + `Retry-After`, indexé sur l'email saisi, remis à zéro au succès, jamais de blocage fixe | `services/loginThrottle.ts` ; `tests/login-throttle.test.ts` |
| 2.4 | Réinitialisation du mot de passe | **non implémentée** (non validée), voir §4 |
| 2.5 | Secrets dans l'environnement, `.env` ignoré, `.env.example` sans valeur | `config.ts`, `.gitignore`, `.env.example` |
| 2.5 | Refus de démarrer (secret manquant ou faible, < 32 octets) | `config.ts` ; `tests/config.test.ts` |
| 2.5 | Aucun secret dans les réponses, les logs ou les JWT | `tests/data-exposure.test.ts` |
| 2.5 | Procédure de rotation de la clé, recherche de secrets dans l'historique | README ; gitleaks (rien trouvé) |
| 3 | Access token de 15 min dans `Authorization: Bearer` ; refresh de 30 j stocké par son `jti` (révocable) | `tokens.ts`, `refreshTokenRepository.ts`, `002_auth.up.sql` |
| 3 | HS256 en dur, `alg` du jeton jamais lu, `none` et autres algorithmes refusés, signature et `exp` vérifiées | `tokens.ts` ; `tests/tokens.test.ts` |
| 3 | Durées explicites dans la configuration | `config.ts` (`accessTokenTtlSeconds`, `refreshTokenTtlSeconds`) |
| 3 | Claims `sub`, `iat`, `nbf`, `exp`, `jti`, `type`, plus `role` dans l'access token seulement ; payload court | `tokens.ts` (schémas stricts) ; `tests/auth.test.ts`, `refresh.test.ts` |
| 3 | `/refresh` refuse un access token et un `jti` révoqué ; `/logout` révoque et supprime le cookie | `authService.refresh`, `authService.logout` ; `tests/refresh.test.ts` |
| 3 | `token_version` incrémenté au changement de mot de passe ou de rôle, comparé à chaque requête | `userRepository.setAdmin` / `changePasswordHash`, `authenticateAccessToken` |
| 3+ | Rotation du refresh, et réutilisation qui révoque toutes les sessions | `authService.refresh` |
| 4 | Deux domaines : access token dans le corps (mémoire côté front), refresh en cookie `HttpOnly; Secure; SameSite=None; Path=/api/auth; Max-Age=2592000` | `cookies.ts`, `authController.ts` ; `tests/cookies-cross-site.test.ts` |
| 4 | `SameSite`, `Secure` et `Domain` configurables, réglages dev (`Lax`, non `Secure`) refusés en production | `config.ts` |
| 5 | Refus par défaut (garde globale et liste blanche) | `authenticate.ts`, `publicRoutes.ts` |
| 5 | Test d'énumération de toutes les routes sans jeton → 401 | `tests/routes.test.ts` |
| 5 | Authentification optionnelle (`optional`), jeton jamais lu dans la query string | `publicRoutes.ts` (mode `optional`) ; `tests/tokens.test.ts` |
| 5 | RBAC réutilisable `requireRole('admin')` → 403, rôle tiré du claim | `requireRole.ts` ; `tests/admin.test.ts` |
| 6 | Vérification de propriété dans le use case, `AccessDenied` → 403 par un filtre unique | `AccessDenied.ts`, `tournamentPolicy.ts`, `errorHandler.ts` ; `tests/rbac-idor.test.ts` |
| 6 | Identifiants non devinables | `users.public_id` (UUID), utilisé comme `sub` et comme `user.id` ; `jti` en UUID |
| 7 | JSON uniquement, CSP `default-src 'none'`, champs texte validés (type, longueur) | `securityHeaders.ts`, schémas Zod |
| 8 | CSRF par double-submit, `GET /auth/csrf`, `X-CSRF-Token`, comparaison en temps constant, 403 ; s'applique aussi à login et register | `security/csrf.ts` ; `tests/csrf.test.ts` |
| 8 | Aucune écriture en `GET` | seules lectures en GET (`/csrf` ne fait que poser un cookie) |
| 8+ | Vérification de l'en-tête `Origin` | `originCheck.ts` |
| 9 | Limites de débit à trois niveaux (global, routes sensibles, par compte) | `rateLimits.ts` ; `tests/rate-limit.test.ts`, `account-quota.test.ts` |
| 9 | Schéma strict sur chaque route, champs inconnus rejetés, pas de mass assignment | `authSchemas.ts` (`strictObject`) ; `tests/data-exposure.test.ts` |
| 9 | 415 hors JSON, corps limité à 100 ko (413) | `requireJson.ts`, `app.ts`, `errorHandler.ts` ; `tests/hardening.test.ts` |
| 9 | Headers de sécurité posés partout, `X-Powered-By` retiré | `securityHeaders.ts`, `app.ts` ; `tests/hardening.test.ts` |
| 9 | Debug interdit en production ; 500 générique avec identifiant de requête | `config.ts`, `requestId.ts`, `errorHandler.ts` |
| 9 | Projection explicite des utilisateurs | `toPublicUser` |
| 9 | Journal des événements de sécurité sans donnée sensible | `securityLog.ts` (login échoué ou retardé, refresh refusé, réutilisation, CSRF, Origin, 403, 429) |
| 9 | CORS : liste blanche, `credentials`, jamais `*` | `app.ts` ; `tests/hardening.test.ts` |
| 9 | Audit des dépendances, gitleaks en CI, procédure de retour arrière | `npm audit fix` (commit dédié), `ci.yml`, README |

Le cours recommande, en production réelle, de déléguer l'authentification à un fournisseur d'identité
(Keycloak, Entra ID, Auth0, Okta). Ici, elle est implémentée à la main pour en comprendre le mécanisme.

## 3. Choix à valider

**Au-delà du cours**
- Rotation du refresh, et détection de réutilisation qui révoque toutes les sessions **et** incrémente
  `token_version`, ce qui coupe aussi les access tokens en cours.
- Vérification d'`Origin`. Une requête sans `Origin` est acceptée, mais le jeton CSRF reste exigé.
- CORS avec liste blanche et credentials. `Cache-Control: no-store` sur les routes `/api/auth`.
- `token_version` stocké dans le claim `ver`. Rejouer un refresh révoqué par un logout ou par un changement
  de rôle compte comme une réutilisation.

**Valeurs par défaut choisies**
- Limites de débit : globale 100/min ; login 5/min ; register 5/min ; refresh 10/min ; csrf 30/min.
- Délai par compte : 1 s, doublé à chaque échec, plafonné à 15 min.
- Taille du corps : 100 ko. Cookie `csrf` : `Max-Age` de 30 jours, `Path=/`.
- Paramètres argon2id : recommandation OWASP (19 Mio, t=2, p=1).
- Liste locale de mots de passe : 73 078 entrées (SecLists, licence MIT).
- `accountQuota` est prêt mais n'est branché sur aucune route (la création de tournoi n'existe pas encore).

**Écarts et interprétations**
- **Rôle.** `is_admin` reste la source de vérité (réponse « touche à rien »). `role` est déduit de cette
  colonne, sans nouvelle colonne en base. Les réponses exposent `role` et `isAdmin`.
- **Routes sous `/api`.** Elles sont sous `/api/auth/*` et non `/auth/*` (préfixe existant). Le cookie de
  refresh a donc `Path=/api/auth`.
- **UUID.** Seuls les utilisateurs ont un identifiant public UUID. Les futures tables (tournois, équipes)
  ont encore un entier comme identifiant public dans le contrat : il faudra leur ajouter un `public_id`
  lors de leur implémentation.
- **Ordre des contrôles.** La garde d'authentification passe avant le CSRF : une route protégée appelée
  sans jeton répond 401, pas 403.
- **Policy des tournois.** Elle accepte l'organisateur ou un admin. Seuls les admins peuvent créer des
  tournois pour l'instant (`requireRole('admin')` à poser sur la future route).
- **Tests IDOR et quota.** Ils passent par des routes factices (option a), branchées sur la vraie garde,
  la vraie policy et le vrai filtre d'exceptions.
- **Mots de passe connus des fuites.** Liste locale uniquement, sans HIBP (« pas encore »).
- **CSRF.** C'est le double-submit simple du cours (pas la variante signée HMAC). Il reste vulnérable au
  « cookie tossing » depuis un sous-domaine compromis.

**Limites connues**
- Les limites de débit sont stockées en mémoire : une seule instance d'API, sinon il faut Redis.
- Le délai par compte est lu avant la vérification asynchrone du mot de passe. Des tentatives strictement
  parallèles peuvent passer ensemble ; la limite de 5/min par IP borne ce cas.
- Deux refresh simultanés avec le même cookie sont vus comme un vol. Le client fourni dans
  `docs/FRONT-INTEGRATION.md` les sérialise (dans l'onglet et entre onglets via Web Locks).

## 4. Comportements changés et tests modifiés

**Routes dont le comportement change**
- `POST /api/auth/register` et `POST /api/auth/login` :
  - exigent `X-CSRF-Token` (sinon 403) et un corps JSON (sinon 415) ;
  - refusent les champs inconnus (400) ;
  - renvoient `accessToken` (au lieu de `token`) avec `expiresIn`, et posent le cookie de refresh ;
  - `user.id` devient un UUID et le champ `role` est ajouté.
- `POST /api/auth/register` : mot de passe de 12 à 256 caractères, hors liste des fuites.
- `POST /api/auth/login` : message « Identifiants invalides », 429 en cas de limite ou de délai, rehachage bcrypt → argon2id.
- `GET /api/auth/me` : un jeton émis avant un changement de rôle ou de mot de passe donne 401 `TOKEN_REVOKED`.
- **Route inconnue sans jeton** : 401 (refus par défaut), 404 avec un jeton valide.
- **Toutes les réponses** : nouveaux headers de sécurité, `X-Request-Id`, plus de `X-Powered-By`, CORS avec credentials.
- **Nouvelles routes** : `GET /api/auth/csrf`, `POST /api/auth/refresh`, `POST /api/auth/logout`.

**Tests existants modifiés** (aucun supprimé)
- `tests/helpers.ts` :
  - le mot de passe de test `motdepasse123` figure dans les fuites, il est remplacé ;
  - les `POST` envoient la paire CSRF ;
  - nouvelle forme de session ;
  - `setAdmin` passe par le service (ce qui incrémente `token_version`).
- `tests/setup.ts` : nettoie aussi `login_failures` et les tournois, et rend les logs silencieux (ils restent espionnables).
- `tests/auth.test.ts` :
  - `token` devient `accessToken`, et l'id devient un UUID ;
  - le test « payload `{sub}` uniquement » vérifie désormais les nouveaux claims ;
  - le test « ignore `is_admin` » attend maintenant 400 ;
  - les jetons forgés ou expirés ont les nouveaux claims ;
  - la route inconnue donne 401 sans jeton, 404 avec un jeton.
- `tests/admin.test.ts` :
  - utilise la garde globale et `requireRole` ;
  - un admin rétrogradé donne 401 `TOKEN_REVOKED` au lieu de 403 ;
  - la promotion exige un nouveau login.

**Non implémenté** (en attente de validation) : réinitialisation du mot de passe (§2.4, proposition dans
le plan), API HIBP, connexion « avec Google ». Tous les tests demandés sont écrits.

## 5. Ce qui reste à faire

**Front**
- Intégrer `docs/FRONT-INTEGRATION.md`.
- Supprimer tout stockage de jeton dans `localStorage`.
- Définir `VITE_API_URL`.
- Mettre une CSP sur l'hébergement du front.

**Déploiement**
- HTTPS (certificats et redirection) sur le reverse proxy.
- Variables `NODE_ENV=production`, `JWT_SECRET` (générée et stockée dans le gestionnaire de secrets),
  `CORS_ORIGINS=https://<front>`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `TRUST_PROXY`.
- Lancer `npm run migrate` sur la base existante, après une sauvegarde.
- Activer la CI sur le dépôt GitHub. Prévoir Redis pour les limites de débit en cas de plusieurs instances.

**Futures routes métier** (`api-routes.md`)
- Les routes publiques sont à déclarer dans `publicRoutes.ts` (mode `optional`).
- `requireRole('admin')` sur les routes admin.
- `assertCan…` dans chaque use case (capitaine, membre, auteur).
- `accountQuota` sur la création de tournoi.
