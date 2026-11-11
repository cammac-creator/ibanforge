import type messages from "@/messages/en.json";
import { waitParts, type WaitParts } from "@/lib/wait-words";

type AuditErrorKey = `upload.error.${keyof typeof messages.audit.upload.error}`;

/** Ce que l'appel a rendu en plus de son corps, quand l'erreur en dépend. */
export interface AuditErrorContext {
  /** Le statut HTTP : un 413 est le refus en octets, un 400 un refus à l'ouverture. */
  status?: number;
  /** L'en-tête `Retry-After`, en secondes, tel que le navigateur le lit. */
  retryAfter?: string | null;
  /** L'attente dite en mots (`common.wait`), fournie par le composant. */
  waitText?: (parts: WaitParts) => string;
}

/**
 * Les refus du dépôt et du paiement, compréhensibles dans la langue du parcours.
 *
 * `file_too_large` a deux familles (11.11.2026, C23) :
 *  - le 413 de la route, le seul refus en octets : « dépasse 10 Mo » ;
 *  - les 400 de l'ouverture du fichier (taille décompressée, parties, colonnes,
 *    cellules, texte, longueur d'une cellule, rapport annoté trop lourd), qui
 *    n'ont rien à voir avec les 10 Mo : un texte vrai pour tous, suivi de la
 *    précision de l'API, en anglais, qui dit lequel.
 *
 * `capacity_reached` (503) donne son attente par l'en-tête `Retry-After` : dite
 * en mots quand elle est lisible, sinon « un peu plus tard ».
 */
export function auditErrorText(
  t: (key: AuditErrorKey, values?: Record<string, string>) => string,
  code?: string,
  message?: string,
  context: AuditErrorContext = {},
): string {
  switch (code) {
    case "no_iban_column":
      return t("upload.error.noIban");
    case "empty":
      return t("upload.error.empty");
    case "too_many_rows":
      return t("upload.error.tooManyRows");
    case "file_too_large": {
      if (context.status === 413) return t("upload.error.tooLarge");
      const lead = t("upload.error.tooBig");
      return message ? `${lead} ${t("upload.error.apiDetail", { detail: message })}` : lead;
    }
    case "capacity_reached": {
      const parts = waitParts(context.retryAfter);
      return parts && context.waitText
        ? t("upload.error.capacity", { wait: context.waitText(parts) })
        : t("upload.error.capacityLater");
    }
    case "unreadable":
      return t("upload.error.unreadable");
    case "checkout_expired":
      return t("upload.error.checkoutExpired");
    case "checkout_in_progress":
      return t("upload.error.checkoutPending");
    case "job_missing":
    case "additional_payment":
    case "payment_session_mismatch":
      return t("upload.error.paymentReview");
    case "already_paid":
      return t("upload.error.alreadyPaid");
    case "job_not_found":
      return t("upload.error.expired");
    case "payments_unavailable":
      return t("upload.error.payments");
    default:
      return message ?? t("upload.error.generic");
  }
}
