import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type DestinationStream } from 'pino';
import type { LogFields, Logger } from '../application/ports.js';

/** Identifiant de la requête en cours, ajouté à toutes les lignes qu'elle produit. */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Mêmes noms de niveaux dans tous les logs, quelle que soit la bibliothèque
const LEVEL_NAMES: Record<string, string> = {
    trace: 'DEBUG',
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARNING',
    error: 'ERROR',
    fatal: 'CRITICAL',
};

/**
 * JSON Lines sur la sortie standard : une ligne par événement, `timestamp` ISO, `level`, `message`.
 * La destination réelle (fichier, plateforme) est choisie par l'hébergeur, pas par le code.
 */
export class PinoLogger implements Logger {
    private readonly pino: pino.Logger;

    constructor(level: string, destination?: DestinationStream) {
        this.pino = pino(
            {
                level,
                base: undefined, // ni pid ni hostname : l'orchestrateur les ajoute s'il en a besoin
                messageKey: 'message',
                timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
                formatters: { level: (label) => ({ level: LEVEL_NAMES[label] ?? label.toUpperCase() }) },
                mixin: () => {
                    const context = requestContext.getStore();
                    return context ? { request_id: context.requestId } : {};
                },
            },
            destination,
        );
    }

    debug(event: string, fields: LogFields = {}): void {
        this.pino.debug(fields, event);
    }

    info(event: string, fields: LogFields = {}): void {
        this.pino.info(fields, event);
    }

    warn(event: string, fields: LogFields = {}): void {
        this.pino.warn(fields, event);
    }

    error(event: string, fields: LogFields = {}): void {
        this.pino.error(fields, event);
    }
}
