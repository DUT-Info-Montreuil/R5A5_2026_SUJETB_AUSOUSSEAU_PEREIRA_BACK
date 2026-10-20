# Brancher le front React (Vite) sur l'authentification de l'API

Ce document s'adresse au dépôt **front**. Les snippets sont des **ajouts** aux pages existantes : quatre
fichiers à créer dans `src/auth/`, puis trois points de branchement (racine, routes, client HTTP).
Ils sont écrits en JSX ; pour un projet TypeScript, renommer en `.tsx`/`.ts` et ajouter les types.

## Ce que fait l'API (rappel)

| Élément | Où il vit côté front | Pourquoi |
|---|---|---|
| Access token (15 min) | **variable en mémoire** du module `apiClient` | pas de `localStorage` / `sessionStorage` : un XSS lirait le jeton |
| Refresh token (30 j) | cookie `HttpOnly` posé par l'API, **invisible en JS** | le front ne le manipule jamais ; il est envoyé grâce à `credentials: 'include'` |
| Jeton anti-CSRF | variable en mémoire, obtenu par `GET /api/auth/csrf` | entre deux domaines, le JS du front ne peut pas lire le cookie `csrf` de l'API |

Au rechargement de la page, la mémoire est vide : le front appelle `POST /api/auth/refresh`, le navigateur
joint le cookie, l'API renvoie un nouvel access token et l'utilisateur. Chaque refresh **fait tourner** le
cookie ; rejouer un ancien refresh déconnecte toutes les sessions. D'où la règle : **un seul refresh à la
fois** (géré ci-dessous, y compris entre onglets et sous `<StrictMode>`).

## 0. Configuration

`.env` du front :

```
VITE_API_URL=http://localhost:3000
```

En production : `VITE_API_URL=https://api.<domaine>`, et côté API `CORS_ORIGINS=https://<front>`.

## 1. `src/auth/apiClient.js` (nouveau) : le client HTTP

```js
// Client HTTP unique vers l'API : Bearer, cookies, CSRF, refresh + rejeu sur 401.
// Le jeton d'accès reste dans ce module (mémoire), jamais dans localStorage/sessionStorage.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Un 401 sur ces routes ne déclenche pas de refresh (identifiants faux, session finie...)
const NO_RETRY = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout']);

let accessToken = null;
let csrfToken = null;
let refreshPromise = null;
let onSessionExpired = () => {};

export class ApiError extends Error {
  constructor(status, body, headers) {
    super(body?.error?.message ?? `Erreur HTTP ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
    this.retryAfter = Number(headers?.get('Retry-After')) || undefined;
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

export function notifySessionExpired() {
  accessToken = null;
  onSessionExpired();
}

export function shouldRetryAfterRefresh(path) {
  return !NO_RETRY.has(path);
}

/** Jeton anti-CSRF, à récupérer avant le premier POST (login compris). */
export async function ensureCsrfToken() {
  if (!csrfToken) {
    const res = await fetch(`${API_URL}/api/auth/csrf`, { credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null), res.headers);
    csrfToken = (await res.json()).csrfToken;
  }
  return csrfToken;
}

// `body` est un objet JS : il est resérialisé à chaque envoi, ce qui permet le rejeu après refresh
async function send(path, { method = 'GET', body, headers, ...rest } = {}) {
  const finalHeaders = new Headers(headers);
  const upper = method.toUpperCase();
  if (accessToken) finalHeaders.set('Authorization', `Bearer ${accessToken}`);
  if (UNSAFE_METHODS.has(upper)) finalHeaders.set('X-CSRF-Token', await ensureCsrfToken());
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');

  return fetch(`${API_URL}${path}`, {
    ...rest,
    method: upper,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include', // envoie les cookies refresh_token et csrf à l'API
  });
}

async function doRefresh() {
  const res = await send('/api/auth/refresh', { method: 'POST' });
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const session = await res.json(); // { accessToken, expiresIn, user }
  accessToken = session.accessToken;
  return session;
}

/**
 * Un seul refresh à la fois : dans l'onglet (refreshPromise, qui couvre aussi le double
 * appel de useEffect en <StrictMode>) et entre onglets (Web Locks API). Deux refresh
 * concurrents avec le même cookie seraient vus par l'API comme un vol de jeton.
 */
export function refreshSession() {
  if (!refreshPromise) {
    const run = navigator.locks
      ? navigator.locks.request('arch-rivals-auth-refresh', doRefresh)
      : doRefresh();
    refreshPromise = run.finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * fetch vers l'API. Sur 401 : une tentative de refresh, puis rejeu de la requête initiale ;
 * si le refresh échoue, la session est terminée (onSessionExpired).
 * Renvoie le JSON (ou null pour 204), lève ApiError sinon.
 */
export async function apiFetch(path, options = {}) {
  let res = await send(path, options);

  // Jeton CSRF périmé (cookie expiré ou supprimé) : on en redemande un, une fois
  if (res.status === 403 && UNSAFE_METHODS.has((options.method ?? 'GET').toUpperCase())) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error?.code === 'CSRF_INVALID') {
      csrfToken = null;
      res = await send(path, options);
    }
  }

  if (res.status === 401 && shouldRetryAfterRefresh(path)) {
    const session = await refreshSession();
    if (session) {
      res = await send(path, options); // rejeu de la requête initiale
    } else {
      notifySessionExpired();
    }
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data, res.headers);
  return data;
}
```

## 2. `src/auth/AuthProvider.jsx` (nouveau) : `AuthProvider` + `useAuth`

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, ensureCsrfToken, refreshSession, setAccessToken, setSessionExpiredHandler } from './apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // 'loading' tant que la restauration de session n'a pas répondu
  const [status, setStatus] = useState('loading');

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Restauration au rechargement : le cookie HttpOnly est joint par le navigateur
  useEffect(() => {
    setSessionExpiredHandler(endSession);
    refreshSession().then((session) => {
      if (session) {
        setUser(session.user);
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
      }
    });
  }, [endSession]);

  const startSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const login = useCallback(async (email, password) => {
    await ensureCsrfToken(); // le login exige X-CSRF-Token (login CSRF)
    startSession(await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } }));
  }, [startSession]);

  const register = useCallback(async ({ username, email, password }) => {
    await ensureCsrfToken();
    startSession(await apiFetch('/api/auth/register', { method: 'POST', body: { username, email, password } }));
  }, [startSession]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo(
    () => ({ user, status, isAuthenticated: status === 'authenticated', login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé sous <AuthProvider>');
  return context;
}
```

## 3. `src/auth/guards.jsx` (nouveau) : `ProtectedRoute` et `IfRole`

```jsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * UX uniquement : cache une page aux visiteurs non connectés ou sans le bon rôle.
 * La vraie protection est côté API (401/403), qui revérifie tout.
 * S'utilise autour d'un élément ou comme route parente (rend <Outlet />).
 */
export function ProtectedRoute({ role, redirectTo = '/login', children }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <p>Chargement…</p>;
  if (status !== 'authenticated') return <Navigate to={redirectTo} replace state={{ from: location }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children ?? <Outlet />;
}

/** Rendu conditionnel selon le rôle (ex. bouton « Créer un tournoi » pour les admins). */
export function IfRole({ role, children, fallback = null }) {
  const { user } = useAuth();
  return user?.role === role ? children : fallback;
}
```

## 4. `src/auth/useApi.js` (nouveau)

```js
import { apiFetch } from './apiClient';

// Pour les composants : const api = useApi(); await api('/api/tournaments', { method: 'POST', body: {...} })
export function useApi() {
  return apiFetch;
}
```

## 5. Points de branchement dans l'existant

**a. Racine de l'application** (`src/main.jsx`) : entourer l'application existante.

```jsx
import { AuthProvider } from './auth/AuthProvider';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>          {/* déjà présent si le projet utilise react-router */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
```

**b. Autour des routes** (là où sont déclarées les `<Route>` existantes) : ne rien réécrire, ajouter des
routes parentes qui gardent les pages concernées (classement de `api-routes.md`).

```jsx
import { ProtectedRoute } from './auth/guards';

<Routes>
  {/* pages publiques existantes, inchangées */}
  <Route path="/" element={<Home />} />
  <Route path="/tournaments/:id" element={<TournamentPage />} />
  <Route path="/login" element={<LoginPage />} />

  {/* pages réservées aux connectés */}
  <Route element={<ProtectedRoute />}>
    <Route path="/my-teams" element={<MyTeamsPage />} />
  </Route>

  {/* pages réservées aux admins */}
  <Route element={<ProtectedRoute role="admin" />}>
    <Route path="/admin/tournaments/new" element={<CreateTournamentPage />} />
  </Route>
</Routes>
```

**c. Client HTTP actuel.**
- S'il s'agit d'un module autour de `fetch` (ex. `src/api.js`) : faire passer ses appels par
  `apiFetch(path, { method, body })` au lieu de `fetch(...)` ; `body` est un **objet** (pas `JSON.stringify`).
- Supprimer toute lecture/écriture de jeton dans `localStorage`/`sessionStorage` et tout ajout manuel
  du header `Authorization` : `apiFetch` s'en charge.
- Si le projet utilise **axios**, l'équivalent est un intercepteur :

```js
import axios from 'axios';
import {
  ensureCsrfToken, getAccessToken, notifySessionExpired, refreshSession, shouldRetryAfterRefresh,
} from './auth/apiClient';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL, withCredentials: true });

api.interceptors.request.use(async (config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (['post', 'put', 'patch', 'delete'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = await ensureCsrfToken();
  }
  return config;
});

api.interceptors.response.use(undefined, async (error) => {
  const original = error.config;
  if (error.response?.status === 401 && !original._retried && shouldRetryAfterRefresh(original.url)) {
    original._retried = true;
    if (await refreshSession()) return api(original); // rejeu de la requête initiale
    notifySessionExpired();
  }
  throw error;
});
```

**d. Page de login existante** : appeler `login` du contexte et afficher les erreurs de l'API.

```jsx
const { login } = useAuth();
const navigate = useNavigate();
const location = useLocation();

async function onSubmit(event) {
  event.preventDefault();
  try {
    await login(email, password);
    navigate(location.state?.from?.pathname ?? '/', { replace: true });
  } catch (err) {
    if (err.status === 429) setError(`Trop de tentatives, réessayez dans ${err.retryAfter ?? 'quelques'} s.`);
    else setError(err.message); // « Identifiants invalides »
  }
}
```

Erreurs d'inscription : `err.details` contient `[{ field, message }]` (mot de passe < 12 caractères, connu
des fuites, email déjà pris en 409…). N'imposer **aucune** règle de composition côté front (pas de
« une majuscule, un chiffre ») : la politique est la longueur et le refus des mots de passe connus.

## 6. Rappels de sécurité côté front

- **Les gardes (`ProtectedRoute`, `IfRole`) et le rendu conditionnel ne sont que de l'UX.** N'importe qui
  peut appeler l'API directement ; la vraie protection est côté serveur (401, 403, vérification de
  propriété dans les use cases).
- Jetons : **jamais** de `localStorage` ni de `sessionStorage`, jamais dans une URL.
- Le cookie de refresh est `HttpOnly` : un XSS ne peut pas le **lire**, mais il peut toujours **agir** au
  nom de l'utilisateur tant que la page est ouverte. `HttpOnly` limite l'exfiltration, il ne rend pas le
  XSS inoffensif : la priorité reste de ne pas en avoir.
- React échappe le texte par défaut : afficher les données utilisateur (noms d'équipe, messages, pseudos)
  comme du **texte** (`{team.name}`).
- **Jamais de `dangerouslySetInnerHTML`** sur une donnée venant d'un utilisateur sans la passer par
  DOMPurify avec une **liste fermée** de balises et d'attributs (jamais de regex maison) :

```jsx
import DOMPurify from 'dompurify';

const clean = DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: [],
});
<div dangerouslySetInnerHTML={{ __html: clean }} />
```

- Servir le front avec une `Content-Security-Policy` restrictive (`script-src 'self'`, `connect-src` limité
  à l'URL de l'API) : elle réduit l'impact d'un XSS.
- CORS (`CORS_ORIGINS`) et `SameSite` ne remplacent pas le jeton anti-CSRF : toujours envoyer
  `X-CSRF-Token` (fait par `apiFetch`).
