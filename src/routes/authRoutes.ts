import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { noStore } from '../middlewares/securityHeaders.js';

// L'authentification est appliquée globalement (middlewares/authenticate.ts) :
// les routes publiques de ce routeur sont déclarées dans security/publicRoutes.ts
export const authRoutes: Router = Router();

authRoutes.use(noStore);

authRoutes.post('/register', authController.register);
authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.get('/me', authController.me);
