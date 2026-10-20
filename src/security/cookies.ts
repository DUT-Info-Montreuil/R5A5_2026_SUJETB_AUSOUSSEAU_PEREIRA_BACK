import type { CookieOptions, Response } from 'express';
import { config } from '../config.js';

export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf';

// Le refresh token n'est envoyé par le navigateur qu'aux routes d'authentification
const REFRESH_COOKIE_PATH = '/api/auth';

function baseOptions(): CookieOptions {
    return {
        secure: config.cookies.secure,
        sameSite: config.cookies.sameSite,
        ...(config.cookies.domain && { domain: config.cookies.domain }),
    };
}

function refreshCookieOptions(): CookieOptions {
    return { ...baseOptions(), httpOnly: true, path: REFRESH_COOKIE_PATH };
}

export function setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), maxAge: config.refreshTokenTtlSeconds * 1000 });
}

export function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

// Pas HttpOnly : c'est la moitié « cookie » du double-submit
export function setCsrfCookie(res: Response, token: string): void {
    res.cookie(CSRF_COOKIE, token, {
        ...baseOptions(),
        httpOnly: false,
        path: '/',
        maxAge: config.refreshTokenTtlSeconds * 1000,
    });
}
