// Crée un compte administrateur à partir de ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
// Usage : npm run seed:admin
import { ZodError } from 'zod';
import { createContainer } from '../container.js';
import { registerBody } from '../features/users/infrastructure/http.js';
import { DomainError } from '../shared/domain/errors.js';
import { loadConfig } from '../shared/infrastructure/config.js';
import { initSchema, openDatabase } from '../shared/infrastructure/database.js';
import { PinoLogger } from '../shared/infrastructure/logger.js';

try {
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    initSchema(db);
    const { authService } = createContainer(db, config, new PinoLogger(config.logLevel));

    const input = registerBody.parse({
        username: process.env.ADMIN_USERNAME,
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
    });
    const admin = await authService.createUser(input, true);
    console.log(`Administrateur créé : ${admin.username} <${admin.email}> (id ${admin.id})`);
} catch (err) {
    if (err instanceof ZodError) {
        console.error('Variables ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD invalides :');
        for (const issue of err.issues) console.error(`  - ${issue.path.join('.')} : ${issue.message}`);
    } else if (err instanceof DomainError) {
        console.error(`Impossible de créer l'administrateur : ${err.message}`);
    } else {
        console.error(err);
    }
    process.exitCode = 1;
}
