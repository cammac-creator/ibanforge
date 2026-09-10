import type messages from "@/messages/en.json";

type AuditErrorKey = `upload.error.${keyof typeof messages.audit.upload.error}`;

/** Les refus de paiement restent compréhensibles dans la langue du parcours. */
export function auditErrorText(t: (key: AuditErrorKey) => string, code?: string, message?: string): string {
  switch (code) {
    case "no_iban_column":
      return t("upload.error.noIban");
    case "empty":
      return t("upload.error.empty");
    case "too_many_rows":
      return t("upload.error.tooManyRows");
    case "file_too_large":
      return t("upload.error.tooLarge");
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
