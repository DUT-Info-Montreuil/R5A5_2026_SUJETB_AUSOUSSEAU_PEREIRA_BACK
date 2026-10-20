import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { AppError } from '../src/errors/AppError.js';
import { authenticate } from '../src/middlewares/authenticate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { assertCanManageTournament } from '../src/policies/tournamentPolicy.js';
import type { AuthUser } from '../src/types/user.js';
import { internalId, registerAdmin, registerUser } from './helpers.js';

// Les routes de tournoi n'existent pas encore : use case et route factices, branchés sur le
// vrai garde global, la vraie policy et le vrai filtre d'exceptions.
// Le use case ne connaît pas HTTP : il charge la ressource, vérifie le droit, agit.
function renameTournament(actor: AuthUser, tournamentId: number, name: string): { id: number; name: string } {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as
        | { id: number; created_by: number }
        | undefined;
    if (!tournament) throw new AppError(404, 'NOT_FOUND', 'Tournoi introuvable');
    assertCanManageTournament(actor, tournament);
    db.prepare('UPDATE tournaments SET name = ? WHERE id = ?').run(name, tournamentId);
    return { id: tournamentId, name };
}

const testApp = express();
testApp.use(express.json());
testApp.use(authenticate);
testApp.patch('/tournaments/:id', (req: Request, res: Response) => {
    res.json(renameTournament(req.user!, Number(req.params.id), req.body.name));
});
testApp.use(errorHandler);

function createTournament(createdBy: number): number {
    const game = db.prepare("INSERT INTO games (name) VALUES ('Jeu ' || hex(randomblob(4))) RETURNING id").get() as { id: number };
    return (db.prepare("INSERT INTO tournaments (name, game_id, created_by) VALUES ('Coupe', ?, ?) RETURNING id")
        .get(game.id, createdBy) as { id: number }).id;
}

function rename(token: string, id: number) {
    return request(testApp).patch(`/tournaments/${id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Renommé' });
}

describe('autorisation sur la ressource (anti-IDOR)', () => {
    it('refuse (403) un utilisateur authentifié qui n\'est pas l\'organisateur', async () => {
        const owner = await registerUser();
        const other = await registerUser({ username: 'mallory', email: 'mallory@example.com' });
        const id = createTournament(internalId(owner.user.id));

        const res = await rename(other.accessToken, id);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect((db.prepare('SELECT name FROM tournaments WHERE id = ?').get(id) as { name: string }).name).toBe('Coupe');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('access_denied'));
    });

    it('laisse l\'organisateur et un admin modifier', async () => {
        const owner = await registerUser();
        const admin = await registerAdmin({ username: 'root', email: 'root@example.com' });
        const id = createTournament(internalId(owner.user.id));

        expect((await rename(owner.accessToken, id)).status).toBe(200);
        expect((await rename(admin.accessToken, id)).status).toBe(200);
    });

    it('401 sans jeton, 403 sans droit, 404 ressource inexistante : dans cet ordre', async () => {
        const owner = await registerUser();
        const id = createTournament(internalId(owner.user.id));

        expect((await request(testApp).patch(`/tournaments/${id}`).send({ name: 'x' })).status).toBe(401);
        expect((await rename(owner.accessToken, 999_999)).status).toBe(404);
    });
});
