import type { Request } from 'express';

// Journal des événements de sécurité, une ligne JSON par événement.
// Ne jamais y mettre : mot de passe, jeton, empreinte, secret, email
type LogValue = string | number | boolean | undefined;

export function securityLog(event: string, req: Request | undefined, data: Record<string, LogValue> = {}): void {
    console.warn(
        JSON.stringify({
            level: 'security',
            event,
            time: new Date().toISOString(),
            requestId: req?.requestId,
            ip: req?.ip,
            method: req?.method,
            path: req?.path,
            ...data,
        }),
    );
}
