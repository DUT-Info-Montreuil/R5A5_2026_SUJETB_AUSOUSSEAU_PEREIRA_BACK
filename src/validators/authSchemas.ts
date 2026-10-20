import { z } from 'zod';
import { isCommonPassword } from '../security/password.js';

const email = z.string().trim().toLowerCase().max(254, 'Email invalide').pipe(z.email('Email invalide'));

// Règles modernes : longueur minimale, aucun jeu de caractères imposé, aucun caractère interdit.
// La borne haute ne sert qu'à éviter un déni de service sur le hachage
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const newPassword = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères`)
    .max(PASSWORD_MAX_LENGTH, `Le mot de passe doit faire au plus ${PASSWORD_MAX_LENGTH} caractères`)
    .refine((p) => !isCommonPassword(p), 'Ce mot de passe figure dans des fuites de données publiques, choisissez-en un autre');

// strictObject : un champ inconnu (is_admin, role...) est rejeté au lieu d'être ignoré
export const registerSchema = z.strictObject({
    username: z
        .string()
        .trim()
        .min(3, 'Le nom d\'utilisateur doit faire au moins 3 caractères')
        .max(32, 'Le nom d\'utilisateur doit faire au plus 32 caractères'),
    email,
    password: newPassword,
});

export const loginSchema = z.strictObject({
    email,
    password: z.string().min(1, 'Mot de passe requis').max(PASSWORD_MAX_LENGTH, 'Identifiants invalides'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
