import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayStatus, ReloadOutcome } from './restricted-overlay-runtime.js';

/**
 * Le journal et les alertes de la surcouche (relecture de la PR 252, R9) : aucune
 * clé d'alerte ne doit rester ouverte à jamais, parce qu'`opsFail` se tait tant
 * qu'une clé est ouverte et que son état survit aux redémarrages.
 */

const ops = vi.hoisted(() => ({ opsFail: vi.fn(), opsOk: vi.fn() }));
vi.mock('./ops-alert.js', () => ops);

const runtime = vi.hoisted(() => ({
  statuses: [] as OverlayStatus[],
  changed: [] as string[],
  reload: (() => []) as () => ReloadOutcome[],
}));
vi.mock('./restricted-overlay-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./restricted-overlay-runtime.js')>();
  return {
    ...actual,
    restrictedOverlayStatus: () => runtime.statuses,
    restrictedOverlaysChanged: () => runtime.changed,
    reloadRestrictedOverlays: () => runtime.reload(),
  };
});

const { overlayWatchTick, reportBootOverlays } = await import('./restricted-overlay-ops.js');

function status(partial: Partial<OverlayStatus>): OverlayStatus {
  return {
    kind: 'bic',
    state: 'applied',
    overlay_path: '/volume/prive/restricted-bic.sqlite',
    served_path: '/volume/prive/restricted-bic.merged-1.sqlite',
    public_path: '/volume/bic.sqlite',
    sha256: 'a'.repeat(64),
    error: null,
    members: [],
    built_at: null,
    duration_ms: 1,
    file: null,
    fallback: false,
    lowered_last_refresh: null,
    housekeeping_error: null,
    ...partial,
  };
}

const keys = (fn: ReturnType<typeof vi.fn>): string[] => fn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  ops.opsFail.mockReset();
  ops.opsOk.mockReset();
  runtime.statuses = [];
  runtime.changed = [];
  runtime.reload = () => [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('démarrage', () => {
  it('le fichier de la variable servi referme aussi l’alerte de rechargement', () => {
    runtime.statuses = [status({ kind: 'bic' }), status({ kind: 'compliance', state: 'off' })];
    reportBootOverlays();
    expect(keys(ops.opsFail)).toEqual([]);
    expect(keys(ops.opsOk)).toEqual([
      'overlay:bic:files',
      'overlay:bic',
      // Aussi pour `off` : une alerte d'entretien d'avant un retrait se referme.
      'overlay:compliance:files',
      'overlay:compliance',
      'overlay:bic:reload',
      'overlay:compliance:reload',
    ]);
  });

  it('un entretien de fichiers en échec est dit, sans éteindre ce qui est servi', () => {
    runtime.statuses = [status({ housekeeping_error: 'EISDIR' })];
    reportBootOverlays();
    expect(keys(ops.opsFail)).toEqual(['overlay:bic:files']);
    expect(String(ops.opsFail.mock.calls[0][1])).toContain('EISDIR');
    expect(keys(ops.opsOk)).toContain('overlay:bic');
  });

  it('un public plus récent gardé n’est jamais une alerte rouge', () => {
    runtime.statuses = [status({ state: 'kept_public' })];
    reportBootOverlays();
    expect(keys(ops.opsFail)).toEqual([]);
    expect(keys(ops.opsOk)).toContain('overlay:bic');
  });

  it('la copie acceptée servie à la place du fichier refusé : rouge, et le refus reste ouvert', () => {
    runtime.statuses = [
      status({ kind: 'compliance', fallback: true, error: 'variable_file_refused:x' }),
    ];
    reportBootOverlays();
    expect(keys(ops.opsFail)).toEqual(['overlay:compliance']);
    expect(String(ops.opsFail.mock.calls[0][1])).toContain('dernière surcouche acceptée');
    expect(keys(ops.opsOk)).not.toContain('overlay:compliance:reload');
  });
});

describe('veille', () => {
  it('rien de changé : aucun appel, aucune fermeture annoncée', () => {
    overlayWatchTick();
    expect(ops.opsFail).not.toHaveBeenCalled();
    expect(ops.opsOk).not.toHaveBeenCalled();
  });

  it('un refus sans surcouche servie dit « base publique seule », pas « la précédente »', () => {
    runtime.changed = ['bic'];
    runtime.reload = () => [
      {
        kind: 'bic',
        changed: false,
        status: status({ state: 'refused', served_path: '/volume/bic.sqlite', sha256: null }),
        rejected: status({ state: 'refused', error: 'overlay_path_invalid' }),
      },
    ];
    overlayWatchTick();
    expect(keys(ops.opsFail)).toEqual(['overlay:bic:reload']);
    expect(String(ops.opsFail.mock.calls[0][1])).toContain('base publique seule');
    expect(String(ops.opsFail.mock.calls[0][1])).not.toContain('précédente');
    expect(keys(ops.opsOk)).toEqual(['overlay:reload']);
  });

  it('une exception ouvre overlay:reload, le premier rechargement abouti la referme', () => {
    runtime.changed = ['bic'];
    runtime.reload = () => {
      throw new Error('volume en lecture seule');
    };
    overlayWatchTick();
    expect(keys(ops.opsFail)).toEqual(['overlay:reload']);
    expect(keys(ops.opsOk)).toEqual([]);

    runtime.reload = () => [{ kind: 'bic', changed: true, status: status({}), rejected: null }];
    overlayWatchTick();
    expect(keys(ops.opsOk)).toEqual([
      'overlay:bic:files',
      'overlay:bic',
      'overlay:bic:reload',
      'overlay:reload',
    ]);
  });
});
