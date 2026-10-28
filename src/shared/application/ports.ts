// Contrats dont dépend la couche application. Les implémentations vivent dans l'infrastructure.

export type LogFields = Record<string, unknown>;

/**
 * Journal des événements métier : le service nomme l'événement (snake_case) et fournit des champs.
 * Le format, le niveau de détail et la destination sont décidés par l'implémentation.
 */
export interface Logger {
    debug(event: string, fields?: LogFields): void;
    info(event: string, fields?: LogFields): void;
    warn(event: string, fields?: LogFields): void;
    error(event: string, fields?: LogFields): void;
}

/** Exécute plusieurs écritures comme une seule : tout est enregistré, ou rien. */
export interface UnitOfWork {
    run<T>(work: () => T): T;
}

export interface Page {
    limit: number;
    offset: number;
}

export interface Paginated<T> {
    items: T[];
    total: number;
}
