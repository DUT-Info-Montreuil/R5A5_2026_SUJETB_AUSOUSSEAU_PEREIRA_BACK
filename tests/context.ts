// Application de test : base SQLite en mémoire, une application neuve avant chaque test
import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { loadConfig } from '../src/shared/infrastructure/config.js';
import { initSchema, openDatabase } from '../src/shared/infrastructure/database.js';
import { PinoLogger } from '../src/shared/infrastructure/logger.js';

export const config = loadConfig();
export const db = openDatabase(':memory:');
initSchema(db);
const logger = new PinoLogger('silent');

// Recréés avant chaque test : compteurs de limitation de débit et d'échecs de connexion remis à zéro
export let container = createContainer(db, config, logger);
export let app = createApp(container, config);

export function resetApp(): void {
    container = createContainer(db, config, logger);
    app = createApp(container, config);
}
