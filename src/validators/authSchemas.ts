import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email('Email invalide'));

export const registerSchema = z.object({
    username: z
        .string()
        .trim()
        .min(3, 'Le nom d\'utilisateur doit faire au moins 3 caractères')
        .max(32, 'Le nom d\'utilisateur doit faire au plus 32 caractères'),
    email,
    password: z
        .string()
        .min(8, 'Le mot de passe doit faire au moins 8 caractères')
        // bcrypt ignore silencieusement tout ce qui dépasse 72 octets
        .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Le mot de passe est trop long (72 octets maximum)'),
});

export const loginSchema = z.object({
    email,
    password: z.string().min(1, 'Mot de passe requis'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
