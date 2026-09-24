import type { Request, Response } from 'express';
import * as authService from '../services/authService.js';
import { loginSchema, registerSchema } from '../validators/authSchemas.js';

export async function register(req: Request, res: Response): Promise<void> {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    res.json(result);
}

export function me(req: Request, res: Response): void {
    res.json({ user: req.user });
}
