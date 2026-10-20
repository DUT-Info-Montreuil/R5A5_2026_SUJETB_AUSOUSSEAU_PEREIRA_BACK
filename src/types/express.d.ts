import type { AuthUser } from './user.js';

declare global {
    namespace Express {
        interface Request {
            // Rempli par le garde global authenticate (absent sur une route publique sans jeton)
            user?: AuthUser;
            // Rempli par le middleware requestId
            requestId: string;
        }
    }
}

export {};
