/**
 * Compteur de dépense des appels de modèles (plan d'audit du 22.09.2026, semaine 2).
 *
 * Chaque réponse de l'interface d'Anthropic porte un champ `usage` : jetons d'entrée et de
 * sortie, jetons écrits et lus dans le cache, recherches web des appels outillés. Personne ne
 * l'enregistrait, et l'audit n'a pu reconstituer ce que le projet dépense que par des détours.
 * `logModelUsage` en écrit une ligne dans le journal de l'API, au même format que les robots
 * du serveur (`~/ibf_usage.py`, qui tiennent en plus un registre mensuel) :
 *
 *   [usage] site=forum-draft model=claude-sonnet-5 input_tokens=1830 output_tokens=412 cache_write=0 cache_read=0 web_search=0
 *
 * Des nombres et le nom du modèle, jamais l'invite ni la réponse. La ligne se construit sans
 * pouvoir lever, quelle que soit la forme du corps : un compteur ne fait jamais échouer la
 * génération qu'il mesure. Les prix ne sont pas convertis ici : ils changent, les jetons non.
 */

/** Les générations de l'API qui appellent un modèle, une étiquette par point d'appel. */
export type ModelUsageSite = 'prospect-radar' | 'forum-draft' | 'forum-translate';

function count(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** La ligne de journal d'une réponse de l'interface (corps JSON décodé, de forme quelconque). */
export function modelUsageLine(site: ModelUsageSite, body: unknown): string {
  const b = record(body);
  const u = record(b.usage);
  const tool = record(u.server_tool_use);
  const model =
    typeof b.model === 'string' && /^[\w.:-]{1,80}$/.test(b.model) ? b.model : 'unknown';
  return (
    `[usage] site=${site} model=${model} input_tokens=${count(u.input_tokens)} ` +
    `output_tokens=${count(u.output_tokens)} cache_write=${count(u.cache_creation_input_tokens)} ` +
    `cache_read=${count(u.cache_read_input_tokens)} web_search=${count(tool.web_search_requests)}`
  );
}

/** Une ligne au journal pour une réponse reçue, qu'elle soit exploitable ou non. */
export function logModelUsage(site: ModelUsageSite, body: unknown): void {
  console.info(modelUsageLine(site, body));
}
