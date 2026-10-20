import type { Request, Response } from 'express';
import * as authService from '../services/authService.js';
import { clearRefreshCookie, CSRF_COOKIE, REFRESH_COOKIE, setCsrfCookie, setRefreshCookie } from '../security/cookies.js';
import { generateCsrfToken, isWellFormedCsrfToken } from '../security/csrf.js';
import { loginSchema, registerSchema } from '../validators/authSchemas.js';

// L'access token part dans le corps (le front le garde en mémoire),
// le refresh token uniquement en cookie HttpOnly
function sendSession(res: Response, session: authService.Session, status = 200): void {
    setRefreshCookie(res, session.refreshToken);
    res.status(status).json({ accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user });
}

// Réutilise le jeton déjà posé : plusieurs onglets partagent le même cookie
export function csrf(req: Request, res: Response): void {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const csrfToken = isWellFormedCsrfToken(existing) ? existing : generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    res.json({ csrfToken });
}

export async function register(req: Request, res: Response): Promise<void> {
    const input = registerSchema.parse(req.body);
    sendSession(res, await authService.register(input), 201);
}

export async function login(req: Request, res: Response): Promise<void> {
    const input = loginSchema.parse(req.body);
    sendSession(res, await authService.login(input, req));
}

export function refresh(req: Request, res: Response): void {
    try {
        sendSession(res, authService.refresh(req.cookies?.[REFRESH_COOKIE], req));
    } catch (err) {
        clearRefreshCookie(res);
        throw err;
    }
}

export function logout(req: Request, res: Response): void {
    authService.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
    res.status(204).end();
}

export function me(req: Request, res: Response): void {
    res.json({ user: authService.getProfile(req.user!.id) });
}
