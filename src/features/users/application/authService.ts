import type { Logger } from '../../../shared/application/ports.js';
import { ConflictError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import { assertAcceptablePassword, type User } from '../domain/user.js';
import type { LoginThrottle, PasswordHasher, TokenService, UserRepository } from './ports.js';

export interface RegisterInput {
    username: string;
    email: string;
    password: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface Session {
    token: string;
    user: User;
}

export interface Authenticated {
    user: User;
    expiresAt: Date;
}

export class AuthService {
    private readonly users: UserRepository;
    private readonly hasher: PasswordHasher;
    private readonly tokens: TokenService;
    private readonly throttle: LoginThrottle;
    private readonly logger: Logger;
    // Comparé quand l'email est inconnu : le temps de réponse ne révèle pas si le compte existe
    private dummyHash?: Promise<string>;

    constructor(deps: { users: UserRepository; hasher: PasswordHasher; tokens: TokenService; throttle: LoginThrottle; logger: Logger }) {
        this.users = deps.users;
        this.hasher = deps.hasher;
        this.tokens = deps.tokens;
        this.throttle = deps.throttle;
        this.logger = deps.logger;
    }

    /** `isAdmin` n'est jamais exposé à l'inscription : seul le script seed:admin le passe à true. */
    async createUser(input: RegisterInput, isAdmin = false): Promise<User> {
        assertAcceptablePassword(input.password);
        const existing = this.users.findByEmailOrUsername(input.email, input.username);
        if (existing.some((u) => u.email === input.email)) {
            throw new ConflictError('EMAIL_TAKEN', 'Cet email est déjà utilisé');
        }
        if (existing.length > 0) throw new ConflictError('USERNAME_TAKEN', 'Ce nom d\'utilisateur est déjà utilisé');

        const passwordHash = await this.hasher.hash(input.password);
        const user = this.users.create({ username: input.username, email: input.email, passwordHash, isAdmin });
        this.logger.info('user_registered', { user: user.id, is_admin: isAdmin });
        return user;
    }

    async register(input: RegisterInput): Promise<Session> {
        const user = await this.createUser(input);
        return { token: this.tokens.sign(user.id), user };
    }

    async login(input: LoginInput): Promise<Session> {
        this.throttle.assertAllowed(input.email);
        const user = this.users.findByEmail(input.email);
        this.dummyHash ??= this.hasher.hash('dummy-password-for-timing');
        const passwordOk = await this.hasher.verify(input.password, user?.passwordHash ?? (await this.dummyHash));

        if (!user || !passwordOk) {
            this.throttle.recordFailure(input.email);
            // Pas d'email dans les logs : donnée personnelle
            this.logger.warn('login_failed', { user: user?.id });
            throw new UnauthenticatedError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
        }
        this.throttle.reset(input.email);
        this.logger.info('login_succeeded', { user: user.id });
        return { token: this.tokens.sign(user.id), user };
    }

    /**
     * Vérifie le jeton puis recharge l'utilisateur : un compte supprimé ou un admin
     * rétrogradé est pris en compte immédiatement, même avec un jeton émis avant.
     */
    authenticate(token: string): Authenticated {
        const { userId, expiresAt } = this.tokens.verify(token);
        const user = this.users.findById(userId);
        if (!user) throw new UnauthenticatedError('INVALID_TOKEN', 'Token invalide');
        return { user, expiresAt };
    }

    /** Relit l'utilisateur pour une action sensible sur une connexion déjà ouverte (droits qui ont pu changer). */
    reload(userId: number): User {
        const user = this.users.findById(userId);
        if (!user) throw new UnauthenticatedError('INVALID_TOKEN', 'Compte introuvable');
        return user;
    }
}
