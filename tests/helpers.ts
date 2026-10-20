import request, { type Response } from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { generateCsrfToken } from '../src/security/csrf.js';
import * as authService from '../src/services/authService.js';

export const validUser = {
    username: 'alice',
    email: 'alice@example.com',
    // 12 caractères minimum, absent des listes de fuites
    password: 'cheval-agrafe-pile-42', // gitleaks:allow (mot de passe de test, pas un secret)
};

// Paire double-submit valide (cookie + header identiques), comme après GET /api/auth/csrf
export const CSRF_TOKEN = generateCsrfToken();

/** POST avec le jeton anti-CSRF ; `cookies` s'ajoutent au cookie csrf. */
export function post(path: string, cookies: string[] = []) {
    return request(app)
        .post(path)
        .set('Cookie', [`csrf=${CSRF_TOKEN}`, ...cookies])
        .set('X-CSRF-Token', CSRF_TOKEN);
}

export interface TestSession {
    accessToken: string;
    user: { id: string; role: string };
    // Header Cookie prêt à renvoyer (refresh_token=...)
    refreshCookie: string;
}

/** Extrait `nom=valeur` d'un Set-Cookie de la réponse. */
export function cookieFrom(res: Response, name: string): string | undefined {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    return setCookie?.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}

function toSession(res: Response): TestSession {
    return { ...res.body, refreshCookie: cookieFrom(res, 'refresh_token')! };
}

export async function registerUser(overrides: Partial<typeof validUser> = {}): Promise<TestSession> {
    const res = await post('/api/auth/register').send({ ...validUser, ...overrides });
    if (res.status !== 201) throw new Error(`register a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return toSession(res);
}

export async function loginUser(email = validUser.email, password = validUser.password): Promise<TestSession> {
    const res = await post('/api/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return toSession(res);
}

export function internalId(publicId: string): number {
    return (db.prepare('SELECT id FROM users WHERE public_id = ?').get(publicId) as { id: number }).id;
}

/** Passe par le service : un changement de rôle invalide les jetons déjà émis. */
export function setAdmin(publicId: string, isAdmin: boolean): void {
    authService.setAdmin(internalId(publicId), isAdmin);
}

/** Crée un administrateur et renvoie une session émise APRÈS la promotion. */
export async function registerAdmin(overrides: Partial<typeof validUser> = {}): Promise<TestSession> {
    const { user } = await registerUser(overrides);
    setAdmin(user.id, true);
    return loginUser(overrides.email ?? validUser.email, overrides.password ?? validUser.password);
}
