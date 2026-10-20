import type { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, mountedRouters } from '../src/app.js';
import { PUBLIC_ROUTES, publicMode } from '../src/security/publicRoutes.js';

interface Layer {
    route?: { path: string; methods: Record<string, boolean> };
    handle: { stack?: Layer[] };
}

/** Toutes les routes enregistrées : celles de l'application et celles des routeurs montés. */
function listRoutes(): { method: string; path: string }[] {
    const routes: { method: string; path: string }[] = [];
    const add = (prefix: string, layer: Layer) => {
        for (const method of Object.keys(layer.route!.methods)) {
            routes.push({ method: method.toUpperCase(), path: prefix + layer.route!.path });
        }
    };

    for (const layer of (app.router as unknown as { stack: Layer[] }).stack) {
        if (layer.route) {
            add('', layer);
        } else if (layer.handle.stack) {
            // Un routeur monté sans être déclaré dans mountedRouters échapperait au test
            const mount = mountedRouters.find((m) => (m.router as unknown) === layer.handle);
            if (!mount) throw new Error('Routeur monté absent de mountedRouters (src/app.ts)');
            for (const sub of (mount.router as Router & { stack: Layer[] }).stack) {
                if (sub.route) add(mount.prefix, sub);
            }
        }
    }
    return routes;
}

const routes = listRoutes();

describe('refus par défaut', () => {
    it('trouve bien les routes (garde-fou du test lui-même)', () => {
        expect(routes).toEqual(expect.arrayContaining([
            { method: 'GET', path: '/api/health' },
            { method: 'GET', path: '/api/auth/me' },
        ]));
    });

    it('la liste blanche est exactement celle décidée (toute nouvelle route publique se décide ici)', () => {
        expect(PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
            'GET /api/auth/csrf',
            'GET /api/health',
            'POST /api/auth/login',
            'POST /api/auth/logout',
            'POST /api/auth/refresh',
            'POST /api/auth/register',
        ]);
    });

    it.each(routes.filter((r) => publicMode(r.method, r.path) === undefined))(
        '$method $path sans jeton → 401',
        async ({ method, path }) => {
            const url = path.replace(/:(\w+)/g, '0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f');
            const res = await request(app)[method.toLowerCase() as 'get'](url);

            expect(res.status).toBe(401);
        },
    );

    it('chaque route publique déclarée existe vraiment', () => {
        for (const r of PUBLIC_ROUTES) {
            expect(routes).toContainEqual({ method: r.method, path: r.path });
        }
    });
});
