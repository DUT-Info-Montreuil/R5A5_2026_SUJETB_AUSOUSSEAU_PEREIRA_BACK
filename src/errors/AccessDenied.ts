/**
 * Exception MÉTIER levée par un use case quand le demandeur n'a pas de droit sur la
 * ressource. Elle ne connaît pas HTTP : c'est errorHandler qui la convertit en 403.
 */
export class AccessDenied extends Error {
    constructor(message = 'Accès refusé') {
        super(message);
        this.name = 'AccessDenied';
    }
}
