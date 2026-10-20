import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

// Recommandation OWASP pour argon2id : 19 Mio, 2 itérations, 1 fil.
// Sel et paramètres sont générés par la bibliothèque et stockés dans l'empreinte
const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const;

// Empreintes créées avant le passage à argon2id
function isLegacyBcryptHash(hash: string): boolean {
    return /^\$2[aby]\$/.test(hash);
}

export function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
}

/** Ne lève jamais : toute erreur de vérification (empreinte corrompue...) vaut `false`. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
        if (isLegacyBcryptHash(hash)) return await bcrypt.compare(password, hash);
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
}

/** Vrai pour une ancienne empreinte bcrypt ou des paramètres argon2 dépassés : rehacher au login. */
export function needsRehash(hash: string): boolean {
    if (isLegacyBcryptHash(hash)) return true;
    try {
        return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
        return true;
    }
}

// Mots de passe de 12 caractères ou plus issus de fuites publiques (SecLists, licence MIT),
// en minuscules. Les plus courts sont déjà refusés par la longueur minimale
const commonPasswords = new Set(
    fs
        .readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf-8')
        .split('\n')
        .filter((line) => line !== ''),
);

export function isCommonPassword(password: string): boolean {
    return commonPasswords.has(password.toLowerCase());
}
