import type { PublicUser } from './user.js';

declare global {
    namespace Express {
        interface Request {
            // Rempli par requireAuth
            user?: PublicUser;
            // Rempli par le middleware requestId
            requestId: string;
        }
    }
}

export {};
