import { match } from 'path-to-regexp';

// Refus par défaut : toute route absente de cette liste exige un access token valide.
// Une route est publique PAR DÉCISION, ajoutée ici et couverte par tests/routes.test.ts.
//   'public'   : le header Authorization est ignoré (routes d'authentification, santé)
//   'optional' : un jeton présent est vérifié et remplit req.user (contenu variable selon la connexion)
export type PublicMode = 'public' | 'optional';

interface PublicRoute {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    mode: PublicMode;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
    { method: 'GET', path: '/api/health', mode: 'public' },
    { method: 'GET', path: '/api/auth/csrf', mode: 'public' },
    { method: 'POST', path: '/api/auth/register', mode: 'public' },
    { method: 'POST', path: '/api/auth/login', mode: 'public' },
    // Identifiées par le cookie de refresh, pas par l'access token
    { method: 'POST', path: '/api/auth/refresh', mode: 'public' },
    { method: 'POST', path: '/api/auth/logout', mode: 'public' },
];

const matchers = PUBLIC_ROUTES.map((route) => ({ ...route, matches: match(route.path) }));

export function publicMode(method: string, path: string): PublicMode | undefined {
    // Express sert HEAD avec le handler GET
    const effective = method === 'HEAD' ? 'GET' : method;
    return matchers.find((r) => r.method === effective && r.matches(path) !== false)?.mode;
}
