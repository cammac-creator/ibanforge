import { parseUtc, type ClientDossier, type DossierKey } from './client-dossiers';

export function keyAtQuota(key: DossierKey): boolean {
  return key.active && key.plan === 'free' && (key.lifetime ? (key.usedAllTime ?? 0) : key.usedThisMonth) >= (key.monthlyLimit ?? 200);
}

/** Décrit les traces et les possibilités actuelles, jamais les pensées du client. */
export function quotaRefusals(dossier: ClientDossier) {
  const anonymous = dossier.email.trim().toLowerCase() === 'anonymous';
  const atQuota = dossier.keys.filter(keyAtQuota);
  const refusals = dossier.authOrQuota + dossier.paywall;
  const firsts = dossier.keys.map((k) => parseUtc(k.firstRefusalAt)?.getTime()).filter((v): v is number => v != null);
  const last = parseUtc(dossier.lastRefusalAt)?.getTime();
  // Une ancienne API sans première date ne permet pas de calculer une durée.
  const complete = dossier.keys.filter((k) => (k.refusals ?? 0) > 0).every((k) => parseUtc(k.firstRefusalAt) != null);
  const minutes = complete && firsts.length && last != null && last >= Math.min(...firsts)
    ? Math.round((last - Math.min(...firsts)) / 60000) : null;
  const canClaim = atQuota.some((k) => k.tier === 'anonymous');
  return {
    anonymous,
    canWrite: !anonymous && dossier.email.includes('@'),
    atQuota,
    refusals,
    minutes,
    visible: anonymous || dossier.verdict === 'blocked' || atQuota.length > 0,
    heading: anonymous
      ? `${atQuota.length} clé${atQuota.length === 1 ? '' : 's'} sur ${dossier.keys.length} à ${atQuota.length === 1 ? 'son' : 'leur'} plafond`
      : atQuota.length > 0 ? 'Quota atteint' : 'Dernier refus observé',
    wayOut: canClaim
      ? 'Pour une clé anonyme à son plafond, l’API propose de réclamer cette même clé avec une adresse vérifiée, ou de payer pour continuer.'
      : atQuota.length > 0
        ? 'L’API propose des crédits par carte ou un paiement à l’appel pour continuer.'
        : null,
  };
}
