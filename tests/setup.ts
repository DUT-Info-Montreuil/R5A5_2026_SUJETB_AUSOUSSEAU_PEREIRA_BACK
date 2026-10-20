import { beforeAll, beforeEach, vi } from 'vitest';
import { db, initSchema } from '../src/db.js';

beforeAll(() => {
    if (db.name !== ':memory:') {
        throw new Error(`Les tests doivent utiliser une base en mémoire (DB_PATH=${db.name})`);
    }
    initSchema();
});

beforeEach(() => {
    // Journal de sécurité et erreurs 500 attendues : silencieux, mais espionnables
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.exec('DELETE FROM users'); // refresh_tokens supprimés en cascade
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'login_failures'").get()) {
        db.exec('DELETE FROM login_failures');
    }
});
