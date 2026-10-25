import type { User } from '../features/users/domain/user.js';

declare global {
    namespace Express {
        interface Request {
            // Rempli par le middleware d'authentification
            user?: User;
        }
    }
}

export {};
