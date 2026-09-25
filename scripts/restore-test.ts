/**
 * Test de restauration d'une sauvegarde de l'état payant (audit du 16/09/2026,
 * axe E : « une sauvegarde jamais restaurée n'est pas une sauvegarde »).
 *
 * Rejoue `restorePaidState` sur une base de statistiques NEUVE et jetable
 * (STATS_DB_PATH pointe sur un fichier temporaire ; les migrations créent le
 * schéma), puis compare ce qui a été inséré à ce que le fichier annonce dans
 * `counts`. Ne touche jamais à la base réelle : le chemin temporaire est
 * imposé ici, avant tout import de la couche base.
 *
 *   npx tsx scripts/restore-test.ts ~/ibanforge-backups/paid-state-AAAA-MM-JJ.json
 *
 * Sortie : une ligne JSON { ok, fichier, format, taken_at, attendu, insere,
 * ecarts, duree_ms }, code de retour 0 si tout est rentré, 1 sinon. Le script
 * launchd mensuel du Mac l'appelle et prévient Claude-Alain par Telegram.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/restore-test.ts <paid-state-*.json>');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'ibanforge-restore-'));
process.env.STATS_DB_PATH = join(work, 'stats.sqlite');
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

const started = Date.now();
const { restorePaidState } = await import('../src/lib/backup.js');
type BackupPayload = import('../src/lib/backup.js').BackupPayload;
type RestoreCounts = BackupPayload['counts'];
const { closeAll } = await import('../src/lib/db.js');

/** Ce que `counts` annonce, rapproché du champ `_inserted` qui lui correspond. */
const PAIRS: Array<[keyof RestoreCounts, string]> = [
  ['api_keys', 'keys_inserted'],
  ['api_usage', 'usage_inserted'],
  ['key_claims', 'claims_inserted'],
  ['key_settlements', 'settlements_inserted'],
  ['key_revocations', 'revocations_inserted'],
  ['lineage_facts', 'lineages_inserted'],
  ['breaker_transitions', 'transitions_inserted'],
  ['key_creations', 'creations_inserted'],
  ['device_grant_daily', 'grant_days_inserted'],
  ['mcp_remote_daily', 'mcp_days_inserted'],
  ['key_purchases', 'purchases_inserted'],
  ['key_topup_refs', 'topup_refs_inserted'],
];

let ok = false;
let verdict: Record<string, unknown>;
try {
  const payload = JSON.parse(readFileSync(file, 'utf8')) as BackupPayload;
  const report = restorePaidState(payload) as unknown as Record<string, number>;
  const attendu: Record<string, number> = {};
  const insere: Record<string, number> = {};
  const ecarts: string[] = [];
  for (const [countKey, insertedKey] of PAIRS) {
    const expected = payload.counts[countKey];
    if (expected === undefined) continue;
    attendu[countKey] = expected;
    insere[countKey] = report[insertedKey] ?? 0;
    if ((report[insertedKey] ?? 0) !== expected) {
      ecarts.push(`${countKey}: annoncé ${expected}, inséré ${report[insertedKey] ?? 0}`);
    }
  }
  ok = ecarts.length === 0 && (attendu.api_keys ?? 0) > 0;
  verdict = {
    ok,
    fichier: file,
    format: payload.format,
    taken_at: payload.taken_at,
    attendu,
    insere,
    ecarts,
    duree_ms: Date.now() - started,
  };
} catch (error) {
  verdict = { ok: false, fichier: file, erreur: String((error as Error).message ?? error) };
} finally {
  try {
    closeAll();
  } catch {
    /* rien : la base jetable disparaît avec le dossier */
  }
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify(verdict));
process.exit(ok ? 0 : 1);
