import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

export const LU_SOURCE = 'Source: ABBL, Luxembourg register of IBAN/BIC codes';
export const LU_PUBLICATION =
  'https://www.abbl.lu/publications/abbl-luxembourg-register-of-iban-bic-codes/';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  });

/** Le registre complet reste dans un fichier privé, hors des paquets et du dépôt. */
export const luRegisterSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal(LU_SOURCE),
    publication: z.literal(LU_PUBLICATION),
    published: date,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z
      .array(
        z.object({
          code: z.string().regex(/^\d{3}$/),
          name: z.string().trim().min(1),
          bic: z.string().regex(/^[A-Z]{4}LU[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/),
        }),
      )
      .min(1)
      .max(1000),
  })
  .superRefine((value, context) => {
    const codes = new Set<string>();
    for (const entry of value.entries) {
      if (codes.has(entry.code)) context.addIssue({ code: 'custom', message: 'Code LU dupliqué' });
      codes.add(entry.code);
    }
  });
export type LuRegister = z.infer<typeof luRegisterSchema>;
let cached:
  { path: string; mtime: number; inode: number; size: number; register: LuRegister } | undefined;

/**
 * Le registre est-il branché sur ce déploiement ? Lu à chaque appel, comme
 * `lookupLuCode` : les textes qui nomment les registres (`src/lib/positioning.ts`)
 * ne citent le Luxembourg que là où ses réponses existent.
 */
export function luRegisterConfigured(): boolean {
  return Boolean(process.env.LU_REGISTER_PATH);
}

/**
 * Activation explicite par fichier privé. Une erreur de lecture configurée remonte
 * jusqu'au garde-fou de l'enrichissement ; elle ne devient jamais une non-attribution.
 * Le remplacement atomique du fichier est détecté sans redémarrer l'API.
 */
export function lookupLuCode(code: string):
  | (LuRegister['entries'][number] & {
      source: string;
      published: string;
    })
  | null {
  const path = process.env.LU_REGISTER_PATH;
  if (!path) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Fichier LU invalide');
  if (
    !cached ||
    cached.path !== path ||
    cached.mtime !== stat.mtimeMs ||
    cached.size !== stat.size ||
    cached.inode !== stat.ino
  ) {
    const register = luRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cached = { path, mtime: stat.mtimeMs, inode: stat.ino, size: stat.size, register };
  }
  const row = cached.register.entries.find((entry) => entry.code === code);
  return row
    ? {
        ...row,
        source: `${cached.register.source} (published ${cached.register.published})`,
        published: cached.register.published,
      }
    : null;
}
