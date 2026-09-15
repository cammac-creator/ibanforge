/**
 * Par quel CLIENT une lignée a réussi, et par quelle PORTE elle est née
 * (chantier « mesure agents », 15/09/2026).
 *
 * ## Pourquoi un module sans aucun import
 *
 * Trois modules lisent ces listes : `lineage-facts.ts` (qui écrit la famille),
 * `lineage-funnel.ts` (qui la ventile) et `agent-entry-daily.ts` (qui borne la
 * colonne `source` de ses agrégats). Les poser ici, sans dépendance, évite
 * d'ajouter un troisième arc au cycle `db.ts` ↔ `lineage-facts.ts` que l'ESM
 * supporte déjà mais qu'il ne faut pas nourrir.
 *
 * ## 🚨 Ce qui est stocké, et ce qui ne l'est jamais
 *
 * Une valeur prise dans une liste FERMÉE, jamais l'User-Agent lui-même. L'UA
 * est une chaîne libre de 256 caractères choisie par l'appelant : le stocker
 * dans `lineage_facts` y ferait entrer un identifiant de client arbitraire, sur
 * une table qui n'a pas la politique de rétention de `request_log` (douze mois,
 * clause du DPA signé) et qui est l'endroit prévu pour l'attribution fine.
 * `request_log.user_agent` garde l'UA brut ; ici, une famille et rien d'autre.
 *
 * ## Les UA ont été RELUS dans les paquets, pas devinés
 *
 * | Famille       | Préfixe d'UA          | Où il est écrit                                   |
 * |---------------|-----------------------|---------------------------------------------------|
 * | `mcp-npm`     | `ibanforge-mcp/`      | `mcp/src/api-client.ts`                           |
 * | `sdk-ts`      | `ibanforge-ts/`       | `sdks/typescript/src/index.ts`                    |
 * | `sdk-python`  | `ibanforge-python/`   | `sdks/python/ibanforge/{client,async_client}.py`   |
 * | `sdk-java`    | `ibanforge-java/`     | `sdks/java/.../IBANforge.java`                    |
 * | `sdk-dotnet`  | `ibanforge-dotnet/`   | `sdks/dotnet/.../IBANforgeClient.cs`              |
 *
 * 🚨 `sdk-ts` se reconnaît à `ibanforge-ts/` et NON à `ibanforge-sdk/` : le
 * paquet TypeScript n'a jamais posé ce dernier préfixe. Une famille écrite sur
 * une supposition aurait rangé tout le SDK TypeScript dans `other`, et le
 * tableau aurait dit « personne n'utilise le SDK » sans que rien ne rougisse.
 *
 * 🚨 Il n'y a PAS de famille `n8n`, et c'est une absence vérifiée :
 * `integrations/n8n/nodes/IbanForge/IbanForge.node.ts` ne pose que
 * `Content-Type` dans ses `requestDefaults.headers`, et
 * `credentials/IbanForgeApi.credentials.ts` que `Authorization`. Un appel venu
 * de n8n porte donc l'UA du client HTTP de n8n, que nous ne contrôlons pas et
 * qui changera sans nous. Il tombe dans `other`. Le jour où l'intégration pose
 * un UA à nous, la famille s'ajoute ici et nulle part ailleurs.
 */

/**
 * La famille de client, en valeurs contrôlées.
 *
 * `other` couvre tout le reste ET l'absence d'UA : un appelant sans UA n'est
 * pas « un navigateur », et le contrat interdit de déduire le contexte d'une
 * trace muette.
 */
export type LineageClient =
  'mcp-npm' | 'sdk-ts' | 'sdk-python' | 'sdk-java' | 'sdk-dotnet' | 'browser' | 'curl' | 'other';

/**
 * Les familles, dans l'ordre où elles sont publiées.
 *
 * Fermée, donc la ventilation du funnel n'a pas besoin d'être bornée à la
 * lecture : elle liste au plus huit seaux, quoi que fasse l'appelant.
 */
export const LINEAGE_CLIENTS: readonly LineageClient[] = [
  'mcp-npm',
  'sdk-ts',
  'sdk-python',
  'sdk-java',
  'sdk-dotnet',
  'browser',
  'curl',
  'other',
] as const;

/**
 * Préfixes d'UA reconnus, du plus spécifique au plus général.
 *
 * Un PRÉFIXE et non une inclusion : `ibanforge-mcp/1.6.0` commence par le
 * nôtre, tandis qu'un UA quelconque qui mentionnerait `ibanforge-mcp` au milieu
 * d'une chaîne n'est pas notre paquet. La barre oblique fait partie du motif,
 * pour qu'un futur `ibanforge-mcp-proxy/` ne soit pas compté comme le paquet.
 */
const UA_PREFIXES: ReadonlyArray<readonly [string, LineageClient]> = [
  ['ibanforge-mcp/', 'mcp-npm'],
  ['ibanforge-ts/', 'sdk-ts'],
  ['ibanforge-python/', 'sdk-python'],
  ['ibanforge-java/', 'sdk-java'],
  ['ibanforge-dotnet/', 'sdk-dotnet'],
  ['curl/', 'curl'],
] as const;

/**
 * La famille de ce succès-ci.
 *
 * Le contexte passe D'ABORD : `demo` veut dire « le panneau du site a exécuté
 * l'appel », et ce panneau tourne dans un navigateur. C'est la règle du brief,
 * et elle est retenue telle quelle.
 *
 * ⚠️ À lire avec la même prudence que le reste : le marqueur de contexte est un
 * en-tête DÉCLARÉ PAR LE CLIENT, exactement comme l'User-Agent. Ni l'un ni
 * l'autre n'est une preuve ; ce sont deux observations, et le contrat de mesure
 * interdit de les présenter autrement.
 */
export function normalizeLineageClient(
  userAgent: string | null | undefined,
  context: string | null | undefined,
): LineageClient {
  if (typeof context === 'string' && context.trim().toLowerCase() === 'demo') return 'browser';
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return 'other';
  const ua = userAgent.trim().toLowerCase();
  for (const [prefix, family] of UA_PREFIXES) {
    if (ua.startsWith(prefix)) return family;
  }
  return 'other';
}

/**
 * Les portes du rail device, en valeurs contrôlées.
 *
 * 🚨 C'est ce qui rend `device_grant_daily` bornée, et c'est la raison pour
 * laquelle cette table peut vivre sans politique de rétention. La `source`
 * d'un grant est une chaîne LIBRE (`normalizeGrantSource` accepte
 * `[a-z0-9_-]{1,40}`, et `POST /v1/keys/generate` fait de même) : la stocker
 * telle quelle ferait de la colonne un jeu d'identifiants choisis par
 * l'appelant, non borné, conservé pour toujours. Trois valeurs, et une seule
 * ligne par valeur et par jour.
 */
export type DeviceDoor = 'web-device' | 'mcp-device' | 'other';

export const DEVICE_DOORS: readonly DeviceDoor[] = ['web-device', 'mcp-device', 'other'] as const;

/** Toute source qui n'est pas une porte connue vaut `other`. */
export function normalizeDeviceDoor(source: string | null | undefined): DeviceDoor {
  const s = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return s === 'web-device' || s === 'mcp-device' ? s : 'other';
}

/**
 * La même réduction, en SQL, pour l'agrégat que la purge écrit en une seule
 * instruction.
 *
 * Écrite ici plutôt que recopiée dans la purge : deux réductions parallèles
 * finiraient par diverger, et c'est toujours celle qu'on ne relit pas qui
 * compte les lignes. `col` est un nom de colonne fourni par l'appelant, jamais
 * une valeur reçue d'une requête.
 */
export function deviceDoorSql(col: string): string {
  return `CASE WHEN ${col} IN ('web-device','mcp-device') THEN ${col} ELSE 'other' END`;
}

/**
 * Les deux portes du rail device, telles qu'elles s'écrivent en `birth_source`.
 *
 * ⚠️ `birth_source` n'est PAS une liste fermée au sens de `LINEAGE_CLIENTS` : il
 * recopie la source DÉCLARÉE par l'appelant, donc sa cardinalité n'est bornée
 * par rien à l'écriture. Le code lui-même n'en produit qu'une poignée
 * (`api-trial`, `web`, et les deux ci-dessous), mais un appelant peut en
 * inventer autant qu'il crée de clés. La ventilation par source est donc bornée
 * À LA LECTURE (voir `BIRTH_SOURCE_BUCKETS` dans `lineage-funnel.ts`) ; cette
 * liste-ci ne sert qu'à SÉLECTIONNER le rail device, où les deux valeurs sont
 * écrites par notre code et par lui seul.
 */
export const DEVICE_BIRTH_SOURCES: readonly string[] = ['web-device', 'mcp-device'] as const;
