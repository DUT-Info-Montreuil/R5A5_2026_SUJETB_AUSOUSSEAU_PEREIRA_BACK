import { beforeAll, beforeEach } from 'vitest';
import { db, initSchema } from '../src/db.js';

beforeAll(() => {
    if (db.name !== ':memory:') {
        throw new Error(`Les tests doivent utiliser une base en mémoire (DB_PATH=${db.name})`);
    }
    initSchema();
});

beforeEach(() => {
    db.exec('DELETE FROM users');
});
