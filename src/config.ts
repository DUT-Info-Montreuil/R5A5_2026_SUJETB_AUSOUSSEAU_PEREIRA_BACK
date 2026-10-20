// Toute la configuration vient de l'environnement et est validée ici, au chargement :
// l'application refuse de démarrer plutôt que de tourner avec un réglage dangereux.
// Les messages d'erreur nomment la variable, jamais sa valeur

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
    }
    return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} doit valoir true ou false`);
}

function intEnv(name: string, fallback: number): number {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} doit être un entier positif`);
    return n;
}

function listEnv(name: string, fallback: string[]): string[] {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') return fallback;
    return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function jwtSecret(): string {
    const secret = requireEnv('JWT_SECRET');
    // 32 octets aléatoires minimum (HS256) ; on écarte aussi les valeurs manifestement non aléatoires
    if (Buffer.byteLength(secret, 'utf8') < 32 || new Set(secret).size < 16) {
        throw new Error('JWT_SECRET trop faible : au moins 32 octets aléatoires (voir .env.example)');
    }
    return secret;
}

type SameSite = 'strict' | 'lax' | 'none';

function sameSiteEnv(): SameSite {
    const value = (process.env.COOKIE_SAMESITE ?? 'none').toLowerCase();
    if (value !== 'strict' && value !== 'lax' && value !== 'none') {
        throw new Error('COOKIE_SAMESITE doit valoir strict, lax ou none');
    }
    return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

export const config = {
    nodeEnv,
    isProduction,
    // Détail des erreurs 500 dans la réponse : interdit en production (vérifié plus bas)
    debug: boolEnv('DEBUG', false),

    jwtSecret: jwtSecret(),
    // Durées explicites : on ne dépend d'aucune valeur par défaut de la bibliothèque
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,

    cookies: {
        secure: boolEnv('COOKIE_SECURE', true),
        sameSite: sameSiteEnv(),
        domain: process.env.COOKIE_DOMAIN || undefined,
    },

    // Origines du front autorisées (CORS et vérification d'Origin)
    corsOrigins: listEnv('CORS_ORIGINS', isProduction ? [] : ['http://localhost:5173']),

    // Nombre de reverse proxies devant l'API (pour que req.ip et req.secure soient justes)
    trustProxy: process.env.TRUST_PROXY ? intEnv('TRUST_PROXY', 1) : false,
    forceHttps: boolEnv('FORCE_HTTPS', isProduction),

    // 100 ko : des formulaires JSON, le plus gros champ (message) fait 2000 caractères
    bodyLimit: '100kb',

    rateLimits: {
        windowMs: 60_000,
        globalPerMinute: intEnv('RATE_LIMIT_GLOBAL_PER_MIN', 100),
        loginPerMinute: intEnv('RATE_LIMIT_LOGIN_PER_MIN', 5),
        registerPerMinute: intEnv('RATE_LIMIT_REGISTER_PER_MIN', 5),
        refreshPerMinute: intEnv('RATE_LIMIT_REFRESH_PER_MIN', 10),
        csrfPerMinute: intEnv('RATE_LIMIT_CSRF_PER_MIN', 30),
    },

    // Délai par compte après un échec de login : 1 s, 2 s, 4 s... plafonné
    loginDelay: {
        baseSeconds: 1,
        maxSeconds: 15 * 60,
    },
} as const;

if (config.cookies.sameSite === 'none' && !config.cookies.secure) {
    throw new Error('COOKIE_SAMESITE=none exige COOKIE_SECURE=true (les navigateurs refusent le cookie sinon)');
}

if (isProduction) {
    if (config.debug) throw new Error('DEBUG=true est interdit en production');
    if (!config.cookies.secure) throw new Error('COOKIE_SECURE=false est interdit en production');
    if (config.corsOrigins.length === 0) throw new Error('CORS_ORIGINS est obligatoire en production');
    if (config.corsOrigins.some((o) => !o.startsWith('https://'))) {
        throw new Error('CORS_ORIGINS : uniquement des origines https:// en production');
    }
}
