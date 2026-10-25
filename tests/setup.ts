import { beforeEach } from 'vitest';
import { db, resetApp } from './context.js';

beforeEach(() => {
    // Enfants avant parents (clés étrangères)
    db.exec(`
        DELETE FROM messages; DELETE FROM join_requests; DELETE FROM matches; DELETE FROM team_members;
        DELETE FROM teams; DELETE FROM tournaments; DELETE FROM game_roles; DELETE FROM games; DELETE FROM users;
    `);
    resetApp();
});
