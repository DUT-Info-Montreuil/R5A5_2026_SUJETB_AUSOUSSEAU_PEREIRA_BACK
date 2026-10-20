// Usage : npm run migrate            (applique les migrations en attente)
//         npm run migrate:rollback   (annule la dernière migration)
import { db, initSchema, rollbackLastMigration } from '../db.js';

const command = process.argv[2] ?? 'up';

try {
    if (command === 'up') {
        initSchema();
        console.log('Schéma à jour');
    } else if (command === 'down') {
        const version = rollbackLastMigration();
        console.log(version ? `Migration annulée : ${version}` : 'Aucune migration à annuler');
    } else {
        console.error(`Commande inconnue : ${command} (attendu : up | down)`);
        process.exitCode = 1;
    }
} finally {
    db.close();
}
