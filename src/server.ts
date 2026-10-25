import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createContainer } from './container.js';
import { initRealtime } from './realtime/socketServer.js';
import { loadConfig } from './shared/infrastructure/config.js';
import { initSchema, openDatabase } from './shared/infrastructure/database.js';
import { PinoLogger } from './shared/infrastructure/logger.js';

const config = loadConfig();
const logger = new PinoLogger(config.logLevel);
const db = openDatabase(config.dbPath);
initSchema(db);

const container = createContainer(db, config, logger);
const server = createServer(createApp(container, config));
const io = initRealtime(server, {
    auth: container.authService,
    chat: container.chatService,
    notifier: container.notifier,
    logger,
    corsOrigins: config.corsOrigins,
});

server.listen(config.port, () => {
    logger.info('server_started', { port: config.port, url: `http://localhost:${config.port}`, docs: `http://localhost:${config.port}/docs` });
});

// Arrêt progressif : plus de nouvelles connexions, on termine les requêtes en cours, puis on ferme la base
function shutdown(signal: string): void {
    logger.info('server_stopping', { signal });
    void io.close(() => {
        db.close();
        logger.info('server_stopped');
        process.exit(0);
    });
    // Filet de sécurité si une connexion refuse de se fermer
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
