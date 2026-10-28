/**
 * Erreurs métier. Elles nomment le problème (`code`) sans rien savoir de HTTP :
 * c'est le gestionnaire d'erreurs de l'infrastructure qui choisit le statut.
 */
export abstract class DomainError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = new.target.name;
        this.code = code;
    }
}

/** La ressource demandée n'existe pas. */
export class NotFoundError extends DomainError {}

/** L'appelant n'est pas identifié : jeton absent, invalide ou expiré. */
export class UnauthenticatedError extends DomainError {}

/** L'appelant est identifié mais n'a pas le droit. */
export class AccessDeniedError extends DomainError {}

/** La demande contredit l'état actuel : équipe complète, inscriptions closes, doublon. */
export class ConflictError extends DomainError {}

/** Les valeurs sont lisibles mais n'ont pas de sens ensemble : rôle d'un autre jeu, match nul. */
export class RuleViolationError extends DomainError {}

/** Trop d'essais : l'appelant doit attendre `retryAfterSeconds`. */
export class TooManyAttemptsError extends DomainError {
    readonly retryAfterSeconds: number;

    constructor(code: string, message: string, retryAfterSeconds: number) {
        super(code, message);
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
