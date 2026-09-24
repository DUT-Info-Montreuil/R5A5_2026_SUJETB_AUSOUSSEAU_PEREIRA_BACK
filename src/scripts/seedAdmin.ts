// Crée un compte administrateur à partir de ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
// Usage : npm run seed:admin
import { ZodError } from 'zod';
import { initSchema } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { createUser } from '../services/authService.js';
import { registerSchema } from '../validators/authSchemas.js';

try {
    initSchema();
    const input = registerSchema.parse({
        username: process.env.ADMIN_USERNAME,
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
    });
    const admin = await createUser(input, true);
    console.log(`Administrateur créé : ${admin.username} <${admin.email}> (id ${admin.id})`);
} catch (err) {
    if (err instanceof ZodError) {
        console.error('Variables ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD invalides :');
        for (const issue of err.issues) console.error(`  - ${issue.path.join('.')} : ${issue.message}`);
    } else if (err instanceof AppError) {
        console.error(`Impossible de créer l'administrateur : ${err.message}`);
    } else {
        console.error(err);
    }
    process.exitCode = 1;
}
