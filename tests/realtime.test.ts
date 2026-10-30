import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRealtime } from '../src/realtime/socketServer.js';
import { app, container } from './context.js';
import { bearer, closedTournament, createTeam, createTournament, matchesOf, quickUser, type TestUser } from './helpers.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

let httpServer: HttpServer;
let io: Server;
let url: string;
const sockets: Socket[] = [];

// Un vrai serveur HTTP + Socket.IO par test, branché sur le conteneur neuf du test
beforeEach(async () => {
    httpServer = createServer(app);
    io = initRealtime(httpServer, {
        auth: container.authService,
        chat: container.chatService,
        notifier: container.notifier,
        logger: container.logger,
        corsOrigins: [ALLOWED_ORIGIN],
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    container.notifier.attach(undefined);
    await io.close();
});

async function client(user?: TestUser, origin?: string): Promise<Socket> {
    const socket = connect(url, {
        auth: user ? { token: user.token } : {},
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: origin ? { Origin: origin } : {},
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    return socket;
}

function join(socket: Socket, event: string, id: number) {
    return socket.emitWithAck(event, id) as Promise<{ ok?: true; error?: { code: string } }>;
}

function next<T = unknown>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
}

// Laisse passer une éventuelle émission avant de conclure qu'il n'y en a pas eu
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('Socket.IO', () => {
    it('refuse la connexion avec un token invalide', async () => {
        await expect(client({ id: 0, token: 'faux' })).rejects.toThrow('INVALID_TOKEN');
    });

    it('refuse une origine non autorisée (CSRF des WebSockets), accepte celle du front', async () => {
        await expect(client(undefined, 'https://site-malveillant.example')).rejects.toThrow();
        await expect(client(undefined, ALLOWED_ORIGIN)).resolves.toBeDefined();
    });

    it('ferme la connexion à l\'expiration du jeton', async () => {
        const user = quickUser();
        const shortLived = jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET!, { expiresIn: 1 });
        const socket = await client({ id: user.id, token: shortLived });

        const expired = next(socket, 'session:expired');
        const closed = next(socket, 'disconnect');
        await expired;
        expect(await closed).toBe('io server disconnect');
    });

    it('B-19 : un visiteur suit un tournoi et voit une nouvelle équipe arriver', async () => {
        const t = createTournament();
        const visitor = await client();
        expect(await join(visitor, 'tournament:join', t.id)).toEqual({ ok: true });

        const update = next<{ teams: unknown[] }>(visitor, 'tournament:updated');
        await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(quickUser())).send({ name: 'Live' });
        expect((await update).teams).toHaveLength(1);
    });

    it('pronostics : les spectateurs du tournoi voient la répartition changer', async () => {
        const t = await closedTournament();
        const visitor = await client();
        await join(visitor, 'tournament:join', t.id);

        const update = next<{ tournamentId: number; participants: number }>(visitor, 'predictions:updated');
        const matches = matchesOf(t.id);
        const picks = matches.map((m) => ({ matchId: m.id, teamId: m.round === 1 ? m.team_a_id! : matches[m.round === 2 ? 2 * m.position - 2 : 0]!.team_a_id! }));
        expect((await request(app).post(`/api/tournaments/${t.id}/predictions`).set(...bearer(quickUser())).send({ picks })).status).toBe(200);
        expect(await update).toMatchObject({ tournamentId: t.id, participants: 1 });
    });

    it('B-16 : salon d\'équipe refusé au visiteur et à l\'extérieur', async () => {
        const t = createTournament();
        const team = createTeam(t.id);

        expect((await join(await client(), 'team:join', team.id)).error?.code).toBe('UNAUTHORIZED');
        expect((await join(await client(quickUser()), 'team:join', team.id)).error?.code).toBe('NOT_TEAM_MEMBER');
        expect(await join(await client(team.captain), 'team:join', team.id)).toEqual({ ok: true });
        expect(await join(await client(quickUser(true)), 'team:join', team.id)).toEqual({ ok: true });
    });

    it('B-16 / B-17 : les membres reçoivent les messages ; l\'exclu est prévenu puis ne reçoit plus rien', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const kicked = team.members[0]!;
        const captainSocket = await client(team.captain);
        const kickedSocket = await client(kicked);
        await join(captainSocket, 'team:join', team.id);
        await join(kickedSocket, 'team:join', team.id);

        const received = next<{ content: string }>(kickedSocket, 'message:new');
        await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(team.captain)).send({ content: 'avant' });
        expect((await received).content).toBe('avant');

        const kickedEvent = next<{ teamId: number }>(kickedSocket, 'member:kicked');
        await request(app).delete(`/api/teams/${team.id}/members/${kicked.id}`).set(...bearer(team.captain));
        expect(await kickedEvent).toEqual({ teamId: team.id });

        const leaked: unknown[] = [];
        kickedSocket.on('message:new', (m) => leaked.push(m));
        const captainGot = next(captainSocket, 'message:new');
        await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(team.captain)).send({ content: 'après' });
        await captainGot;
        await settle();
        expect(leaked).toEqual([]);

        // Et il ne peut pas revenir dans le salon
        expect((await join(kickedSocket, 'team:join', team.id)).error?.code).toBe('NOT_TEAM_MEMBER');
    });

    it('demandes d\'adhésion : le capitaine voit la demande arriver, l\'auteur sa réponse, personne d\'autre', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const applicant = quickUser();
        const captainSocket = await client(team.captain);
        const applicantSocket = await client(applicant);
        const outsiderSocket = await client(quickUser());
        const leaked: unknown[] = [];
        outsiderSocket.on('joinRequest:new', (r) => leaked.push(r));
        outsiderSocket.on('joinRequest:updated', (r) => leaked.push(r));

        const created = next<{ id: number; team: { id: number } }>(captainSocket, 'joinRequest:new');
        const res = await request(app).post(`/api/teams/${team.id}/join-requests`).set(...bearer(applicant));
        expect((await created).team.id).toBe(team.id);

        const updated = next<{ status: string }>(applicantSocket, 'joinRequest:updated');
        await request(app).post(`/api/join-requests/${res.body.joinRequest.id}/reject`).set(...bearer(team.captain));
        expect((await updated).status).toBe('rejected');

        await settle();
        expect(leaked).toEqual([]);
    });

    it('demandes d\'adhésion : l\'auteur apprend le rejet de sa demande à la clôture', async () => {
        const t = createTournament();
        const teams = Array.from({ length: 8 }, () => createTeam(t.id, 5));
        const applicant = quickUser();
        container.repositories.joinRequests.create(teams[0]!.id, applicant.id);
        const socket = await client(applicant);

        const updated = next<{ status: string }>(socket, 'joinRequest:updated');
        await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(t.admin));
        expect((await updated).status).toBe('rejected');
    });
});
