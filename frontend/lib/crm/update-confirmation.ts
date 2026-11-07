/** Une réponse HTTP réussie ne prouve pas à elle seule l’enregistrement demandé. */
export const UNCONFIRMED_UPDATE = 'Enregistrement non confirmé.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Contrat des modifications de message et de prospect : nombre de lignes mises à jour. */
export function isUpdateConfirmed(body: unknown): boolean {
  if (!isRecord(body) || !Object.hasOwn(body, 'updated')) return false;
  return typeof body.updated === 'number' && Number.isSafeInteger(body.updated) && body.updated > 0;
}

/** Une règle idempotente confirme l’adresse normalisée et la valeur demandée, même pour un retrait. */
export function isSenderRuleConfirmed(body: unknown, address: string, value: boolean): boolean {
  return isRecord(body) && Object.hasOwn(body, 'address') && Object.hasOwn(body, 'value')
    && body.address === address.trim().toLowerCase() && body.value === value;
}
