import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { csrfRateLimit, loginRateLimit, refreshRateLimit, registerRateLimit } from '../middlewares/rateLimits.js';
import { noStore } from '../middlewares/securityHeaders.js';

// L'authentification est appliquée globalement (middlewares/authenticate.ts) :
// les routes publiques de ce routeur sont déclarées dans security/publicRoutes.ts
export const authRoutes: Router = Router();

authRoutes.use(noStore);

authRoutes.get('/csrf', csrfRateLimit, authController.csrf);
authRoutes.post('/register', registerRateLimit, authController.register);
authRoutes.post('/login', loginRateLimit, authController.login);
authRoutes.post('/refresh', refreshRateLimit, authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.get('/me', authController.me);
