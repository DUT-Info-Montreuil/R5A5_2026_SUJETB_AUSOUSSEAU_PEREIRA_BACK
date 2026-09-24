import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';

export const validUser = {
    username: 'alice',
    email: 'alice@example.com',
    password: 'motdepasse123',
};

export async function registerUser(overrides: Partial<typeof validUser> = {}) {
    const res = await request(app).post('/api/auth/register').send({ ...validUser, ...overrides });
    if (res.status !== 201) throw new Error(`register a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { token: string; user: { id: number } };
}

export function setAdmin(userId: number, isAdmin: boolean): void {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}
