import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ChatService } from '../features/chat/application/chatService.js';
import type { AuthService } from '../features/users/application/authService.js';
import type { User } from '../features/users/domain/user.js';
import type { Logger } from '../shared/application/ports.js';
import { DomainError, UnauthenticatedError } from '../shared/domain/errors.js';
import { rooms, type SocketIoNotifier } from './socketIoNotifier.js';

type Ack = (response: { ok: true } | { error: { code: string; message: string } }) => void;

const INVALID_ID = { error: { code: 'VALIDATION_ERROR', message: 'Identifiant invalide' } };
// setTimeout n'accepte pas plus de 2^31 - 1 ms (environ 24 jours)
const MAX_TIMER_MS = 2 ** 31 - 1;

function parseId(value: unknown): number | undefined {
    return Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

interface Deps {
    auth: AuthService;
    chat: ChatService;
    notifier: SocketIoNotifier;
    logger: Logger;
    corsOrigins: string[];
}

function onConnection(socket: Socket, { auth, chat, logger }: Deps): void {
    const user = socket.data.user as User | undefined;
    const expiresAt = socket.data.expiresAt as Date | undefined;
    logger.info('socket_connected', { socket_id: socket.id, user: user?.id });

    if (user && expiresAt) {
        void socket.join(rooms.user(user.id));
        // Le jeton n'est vérifié qu'à l'ouverture : on ferme à son expiration, le client revient avec un jeton neuf
        const timer = setTimeout(() => {
            socket.emit('session:expired');
            socket.disconnect(true);
        }, Math.min(Math.max(expiresAt.getTime() - Date.now(), 0), MAX_TIMER_MS));
        socket.on('disconnect', () => clearTimeout(timer));
    }
    socket.on('disconnect', (reason) => logger.info('socket_disconnected', { socket_id: socket.id, user: user?.id, reason }));

    // B-19 : tout le monde, même sans compte, peut suivre un tournoi
    socket.on('tournament:join', (rawId: unknown, ack?: Ack) => {
        const id = parseId(rawId);
        if (!id) return ack?.(INVALID_ID);
        void socket.join(rooms.tournament(id));
        ack?.({ ok: true });
    });
    socket.on('tournament:leave', (rawId: unknown) => {
        const id = parseId(rawId);
        if (id) void socket.leave(rooms.tournament(id));
    });

    // B-16 : même règle que l'historique HTTP, revérifiée en base à chaque entrée (IDOR sur l'identifiant du salon)
    socket.on('team:join', (rawId: unknown, ack?: Ack) => {
        const id = parseId(rawId);
        if (!id) return ack?.(INVALID_ID);
        try {
            if (!user) throw new UnauthenticatedError('UNAUTHORIZED', 'Authentification requise');
            chat.assertCanRead(id, auth.reload(user.id));
            void socket.join(rooms.team(id));
            ack?.({ ok: true });
        } catch (err) {
            if (!(err instanceof DomainError)) {
                logger.error('socket_handler_failed', { exception: err instanceof Error ? err.name : typeof err, error: String(err) });
                return ack?.({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } });
            }
            logger.warn('socket_room_refused', { socket_id: socket.id, user: user?.id, room: rooms.team(id), exception: err.name, error: err.code });
            ack?.({ error: { code: err.code, message: err.message } });
        }
    });
    socket.on('team:leave', (rawId: unknown) => {
        const id = parseId(rawId);
        if (id) void socket.leave(rooms.team(id));
    });
}

export function initRealtime(httpServer: HttpServer, deps: Deps): Server {
    const io = new Server(httpServer, {
        cors: { origin: deps.corsOrigins },
        // Les WebSockets échappent au CORS du navigateur : on vérifie l'origine nous-mêmes.
        // Sans header Origin (client non navigateur), seule l'authentification compte.
        allowRequest: (req, callback) => {
            const origin = req.headers.origin;
            const allowed = origin === undefined || deps.corsOrigins.includes(origin);
            if (!allowed) deps.logger.warn('socket_rejected', { reason: 'ORIGIN_NOT_ALLOWED', origin });
            callback(null, allowed);
        },
    });

    // Jeton facultatif (handshake `auth: { token }`) : sans jeton, on est visiteur
    io.use((socket, next) => {
        const token: unknown = socket.handshake.auth?.token;
        if (typeof token !== 'string' || token === '') return next();
        try {
            const { user, expiresAt } = deps.auth.authenticate(token);
            socket.data.user = user;
            socket.data.expiresAt = expiresAt;
            next();
        } catch (err) {
            const code = err instanceof DomainError ? err.code : 'INVALID_TOKEN';
            deps.logger.warn('socket_rejected', { reason: code });
            next(new Error(code));
        }
    });
    io.on('connection', (socket) => onConnection(socket, deps));

    deps.notifier.attach(io);
    return io;
}
