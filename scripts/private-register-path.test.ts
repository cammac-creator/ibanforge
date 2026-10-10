import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PRIVATE_REGISTERS_DIR,
  assertPrivateRegisterPath,
  enclosingRepository,
  privateRegisterPath,
} from './private-register-path.js';

/**
 * Où les deux registres s'écrivent : jamais dans une partie suivie du dépôt. Le
 * contrôle est celui de git (`check-ignore`), pas une règle recopiée.
 */

const ROOT = resolve(import.meta.dirname, '..');
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

describe('le dossier privé par défaut', () => {
  it('est sous docs/internal/, et git l’ignore', () => {
    expect(PRIVATE_REGISTERS_DIR).toBe(join(ROOT, 'docs/internal/registres-ee-me-2026-10-08'));
    expect(() =>
      assertPrivateRegisterPath(join(PRIVATE_REGISTERS_DIR, 'ee-register.json')),
    ).not.toThrow();
    expect(() =>
      assertPrivateRegisterPath(join(PRIVATE_REGISTERS_DIR, 'me-register.json')),
    ).not.toThrow();
  });

  it('cède la place à la variable d’environnement', () => {
    expect(privateRegisterPath('EE_REGISTER_PATH', 'ee-register.json')).toBe(
      join(PRIVATE_REGISTERS_DIR, 'ee-register.json'),
    );
    vi.stubEnv('EE_REGISTER_PATH', '/var/ee.json');
    expect(privateRegisterPath('EE_REGISTER_PATH', 'ee-register.json')).toBe('/var/ee.json');
  });
});

describe('assertPrivateRegisterPath', () => {
  it('refuse un chemin relatif ou qui n’est pas du JSON', () => {
    expect(() => assertPrivateRegisterPath('ee-register.json')).toThrow(/absolu/);
    expect(() => assertPrivateRegisterPath(join(tmpdir(), 'ee-register.txt'))).toThrow(/absolu/);
  });

  it('refuse un chemin que git suivrait dans le dépôt', () => {
    for (const tracked of [
      'src/db/ee-register.json',
      'data/ee-register.json',
      'scripts/fixtures/registers/ee-register.json',
      'ee-register.json',
    ]) {
      expect(() => assertPrivateRegisterPath(join(ROOT, tracked)), tracked).toThrow(/\.gitignore/);
    }
  });

  it('accepte un chemin hors de tout dépôt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-private-'));
    directories.push(dir);
    expect(enclosingRepository(join(dir, 'ee-register.json'))).toBeNull();
    expect(() => assertPrivateRegisterPath(join(dir, 'ee-register.json'))).not.toThrow();
  });

  it('accepte un dossier ignoré d’un dépôt, et seulement lui', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-repo-'));
    directories.push(dir);
    expect(spawnSync('git', ['init', '-q', dir]).status).toBe(0);
    spawnSync('sh', ['-c', `printf 'prive/\\n' > '${join(dir, '.gitignore')}'`]);
    expect(() => assertPrivateRegisterPath(join(dir, 'prive/ee-register.json'))).not.toThrow();
    expect(() => assertPrivateRegisterPath(join(dir, 'public/ee-register.json'))).toThrow(
      /\.gitignore/,
    );
  });
});
