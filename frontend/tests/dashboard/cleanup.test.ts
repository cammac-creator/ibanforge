import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupRecipe, signalChildren } from './cleanup';

const wait = async () => {};

describe('nettoyage après interruption de la recette', () => {
  it('poursuit les arrêts après un refus de signal et conserve cette erreur', () => {
    const children = new Set(['refusé', 'autre']), errors: unknown[] = [];
    const terminate = vi.fn((child: string) => { if (child === 'refusé') throw new Error('kill EPERM'); children.delete(child); });
    expect(() => signalChildren(children, terminate, 'SIGTERM', errors)).not.toThrow();
    expect(terminate.mock.calls.map(call => call[0])).toEqual(['refusé', 'autre']);
    expect(children).toEqual(new Set(['refusé'])); expect(errors).toHaveLength(1);
  });

  it('ferme un vrai serveur et efface la copie après arrêt confirmé, même si un signal a été refusé', async () => {
    const server = createServer((_request, response) => response.end('fixture locale'));
    const directory = await mkdtemp(path.join(tmpdir(), 'ibf-cleanup-test-'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const children = new Set(['premier', 'second']);
    const signals: string[] = [];
    try {
      await expect(cleanupRecipe({ children, wait,
        terminate: (child, signal) => { signals.push(child + ':' + signal); if (child === 'premier' && signal === 'SIGTERM') throw new Error('kill EPERM'); children.delete(child); },
        closeFixture: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
        removeTemporary: () => rm(directory, { recursive: true, force: true }),
      })).rejects.toThrow('kill EPERM');
      expect(signals).toEqual(['premier:SIGTERM', 'second:SIGTERM', 'premier:SIGKILL']);
      expect(server.listening).toBe(false); expect(children.size).toBe(0);
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ferme la fixture mais conserve la copie tant qu’un enfant ne confirme pas sa fin', async () => {
    const closeFixture = vi.fn(async () => {}), removeTemporary = vi.fn(async () => {});
    await expect(cleanupRecipe({ children: new Set(['vivant']), terminate: () => {}, closeFixture, removeTemporary, wait })).rejects.toThrow('n’a pas confirmé son arrêt');
    expect(closeFixture).toHaveBeenCalledOnce(); expect(removeTemporary).not.toHaveBeenCalled();
  });

  it('conserve la copie et refuse le succès si la fixture ne peut pas se fermer', async () => {
    const removeTemporary = vi.fn(async () => {});
    await expect(cleanupRecipe({ children: new Set(), terminate: () => {}, wait,
      closeFixture: async () => { throw new Error('écoute non libérée'); }, removeTemporary,
    })).rejects.toThrow('écoute non libérée');
    expect(removeTemporary).not.toHaveBeenCalled();
  });

  it('remonte aussi un échec de suppression et les erreurs déjà reçues par le gestionnaire de signal', async () => {
    const errors = [new Error('signal initial refusé')];
    await expect(cleanupRecipe({ children: new Set(), terminate: () => {}, wait, errors,
      closeFixture: async () => {}, removeTemporary: async () => { throw new Error('copie non supprimée'); },
    })).rejects.toThrow('signal initial refusé ; copie non supprimée');
  });

  it('ne déclare le nettoyage normal réussi qu’après fermeture puis suppression', async () => {
    const steps: string[] = [], children = new Set(['enfant']);
    await expect(cleanupRecipe({ children, wait,
      terminate: child => { steps.push('arrêt'); children.delete(child); },
      closeFixture: async () => { steps.push('fermeture'); }, removeTemporary: async () => { steps.push('suppression'); },
    })).resolves.toBeUndefined();
    expect(steps).toEqual(['arrêt', 'fermeture', 'suppression']);
  });
});
