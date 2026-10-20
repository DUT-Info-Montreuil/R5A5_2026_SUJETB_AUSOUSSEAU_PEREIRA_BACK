export class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    // En-têtes à poser sur la réponse d'erreur (ex. Retry-After sur un 429)
    readonly headers?: Record<string, string>;

    constructor(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.headers = headers;
    }
}
