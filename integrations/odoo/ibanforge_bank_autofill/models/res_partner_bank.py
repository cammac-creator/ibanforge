# Part of IBANforge Bank Auto-fill. See LICENSE file for full copyright and licensing details.

import logging

try:
    import requests
except ImportError:  # pragma: no cover - declared in external_dependencies
    requests = None

from odoo import api, fields, models, _

_logger = logging.getLogger(__name__)

# Default IBANforge API base URL. Overridable via the ibanforge.base_url config parameter.
DEFAULT_BASE_URL = "https://api.ibanforge.com"

# Short timeout: the lookup must never make an Odoo form feel sluggish.
LOOKUP_TIMEOUT = 4

# Refusals the user can act on. Until 09.11.2026 every HTTP error was logged at
# debug level and swallowed, so a key that ran out of quota simply stopped
# filling the BIC and nobody knew why. These statuses now raise a non-blocking
# warning on the form; any other error stays silent and logged.
REFUSAL_STATUSES = (401, 402, 403, 429)
# The API answers 402 for a spent allowance AND for a key it does not know
# (mistyped, truncated, revoked): only ``cause.reason`` in the body tells them
# apart. The warning is chosen from it, and stays neutral when it is missing,
# so a mistyped key is never sent to buy credits that would change nothing.
KEY_REFUSAL_REASONS = ("invalid_api_key", "key_revoked_burst")
QUOTA_REFUSAL_REASONS = (
    "monthly_quota_exhausted",
    "monthly_quota_insufficient",
    "credits_exhausted",
    "credits_insufficient",
)
REFUSAL_KEY = "key"
REFUSAL_QUOTA = "quota"
REFUSAL_RATE = "rate"
REFUSAL_UNKNOWN = "unknown"
PRICING_URL = "https://ibanforge.com/pricing?utm_source=odoo"


class ResPartnerBank(models.Model):
    _inherit = "res.partner.bank"

    # Non-stored helper fields used purely for instant UX feedback in the form.
    # They are never persisted: the authoritative bank link is bank_id.
    ibanforge_detected_bic = fields.Char(
        string="Detected BIC",
        store=False,
        readonly=True,
        help="BIC detected by IBANforge. Saved as a bank record when the "
        "account is stored.",
    )
    ibanforge_detected_bank_name = fields.Char(
        string="Detected Bank",
        store=False,
        readonly=True,
        help="Bank name detected by IBANforge. Saved as a bank record when "
        "the account is stored.",
    )
    ibanforge_info = fields.Char(
        string="IBANforge Info",
        store=False,
        readonly=True,
        help="SEPA reachability and country risk indicators returned by "
        "IBANforge.",
    )

    # ------------------------------------------------------------------
    # API helper
    # ------------------------------------------------------------------
    def _ibanforge_lookup(self, iban):
        """Call the IBANforge validate endpoint for ``iban``.

        Returns the parsed JSON ``dict`` on success, or ``None`` when no API
        key is configured, on any network/HTTP error, or when ``requests`` is
        unavailable. This method never raises: the module must never block a
        bank account from being entered or saved.
        """
        data, _refusal = self._ibanforge_request(iban)
        return data

    def _ibanforge_request(self, iban):
        """Same call as ``_ibanforge_lookup``, with the refusal it met.

        Returns ``(data, refusal)``: ``data`` is what ``_ibanforge_lookup``
        returns, and ``refusal`` says why the API refused the call (one of
        ``REFUSAL_KEY``, ``REFUSAL_QUOTA``, ``REFUSAL_RATE`` or
        ``REFUSAL_UNKNOWN``), else ``None``. Never raises either.
        """
        if not iban or requests is None:
            return None, None

        get_param = self.env["ir.config_parameter"].sudo().get_param
        api_key = get_param("ibanforge.api_key")
        if not api_key:
            # No key configured: stay completely offline (no network call).
            return None, None

        base_url = (get_param("ibanforge.base_url") or DEFAULT_BASE_URL).rstrip("/")
        url = "%s/v1/iban/validate" % base_url

        try:
            response = requests.post(
                url,
                headers={"X-API-Key": api_key},
                json={"iban": iban},
                timeout=LOOKUP_TIMEOUT,
            )
            status = response.status_code
            if status in REFUSAL_STATUSES:
                refusal = self._ibanforge_refusal_kind(response)
                # Logged without the key, which never leaves the settings.
                _logger.info(
                    "IBANforge lookup refused with HTTP %s (%s) for %s",
                    status,
                    refusal,
                    url,
                )
                return None, refusal
            if status >= 400:
                _logger.debug(
                    "IBANforge lookup returned HTTP %s for %s",
                    status,
                    url,
                )
                return None, None
            return response.json(), None
        except requests.RequestException as err:
            _logger.debug("IBANforge lookup network error: %s", err)
            return None, None
        except Exception as err:  # noqa: BLE001 - never let a lookup break Odoo
            _logger.debug("IBANforge lookup unexpected error: %s", err)
            return None, None

    def _ibanforge_refusal_kind(self, response):
        """Why the API refused: the key, its allowance, the request rate, or unknown.

        401 and 403 are read as a key refusal and 429 as the rate limiter. A
        402 is told apart by ``cause.reason`` in its body; a body that is not
        JSON, or carries no known reason, gives ``REFUSAL_UNKNOWN``.
        """
        status = response.status_code
        if status in (401, 403):
            return REFUSAL_KEY
        if status == 429:
            return REFUSAL_RATE
        reason = None
        try:
            body = response.json()
            cause = body.get("cause") if isinstance(body, dict) else None
            reason = cause.get("reason") if isinstance(cause, dict) else None
        except Exception:  # noqa: BLE001 - a body that is not JSON says nothing
            reason = None
        if reason in KEY_REFUSAL_REASONS:
            return REFUSAL_KEY
        if reason in QUOTA_REFUSAL_REASONS:
            return REFUSAL_QUOTA
        return REFUSAL_UNKNOWN

    def _ibanforge_refusal_warning(self, refusal):
        """The non-blocking warning for a refusal. Never shows the key."""
        if refusal == REFUSAL_KEY:
            message = _(
                "IBANforge did not fill the bank details: the API refused the "
                "API key, which is mistyped or was revoked. Check it in "
                "Settings; you can still save this account."
            )
        elif refusal == REFUSAL_QUOTA:
            message = _(
                "IBANforge did not fill the bank details: the allowance of the "
                "API key is used up. You can still save this account. "
                "Credit packs and plans: %s"
            ) % PRICING_URL
        elif refusal == REFUSAL_RATE:
            message = _(
                "IBANforge did not fill the bank details: too many requests in "
                "a short time. Try again in a minute; you can still save this "
                "account."
            )
        else:
            message = _(
                "IBANforge did not fill the bank details: the API refused the "
                "request. The API key may be mistyped, or its allowance used "
                "up. Check the key in Settings; you can still save this "
                "account. Credit packs and plans: %s"
            ) % PRICING_URL
        return {"title": _("IBANforge"), "message": message}

    def _ibanforge_build_info(self, data):
        """Build the optional SEPA/risk badge string from the API payload."""
        if not data:
            return False
        get_param = self.env["ir.config_parameter"].sudo().get_param
        if get_param("ibanforge.enable_risk_badge") in (False, "False", "0", "", None):
            return False

        parts = []
        sepa = data.get("sepa") or {}
        if sepa.get("member"):
            parts.append(_("SEPA member"))
        risk = data.get("risk_indicators") or {}
        country_risk = risk.get("country_risk")
        if country_risk:
            parts.append(_("Country risk: %s") % country_risk)
        clearing = data.get("clearing")
        if clearing:
            parts.append(_("Clearing data available"))
        return " · ".join(parts) if parts else False

    def _ibanforge_find_bank(self, bic_code):
        """Return the first existing res.bank matching ``bic_code`` (case-insensitive)."""
        if not bic_code:
            return self.env["res.bank"]
        return self.env["res.bank"].search(
            [("bic", "=ilike", bic_code)], order="id", limit=1
        )

    # ------------------------------------------------------------------
    # Onchange (instant feedback, NEVER creates a record)
    # ------------------------------------------------------------------
    @api.onchange("acc_number")
    def _onchange_acc_number_ibanforge(self):
        # Reset helper fields so stale data never lingers on the form.
        self.ibanforge_detected_bic = False
        self.ibanforge_detected_bank_name = False
        self.ibanforge_info = False

        if not self.acc_number or self.acc_type != "iban":
            return

        data, refusal = self._ibanforge_request(self.acc_number)
        if data is None:
            if refusal:
                # The API refused the call: say why, without blocking entry.
                return {"warning": self._ibanforge_refusal_warning(refusal)}
            # No key / network error: stay silent, never block entry.
            return

        if data.get("valid") is False:
            # Non-blocking warning; base_iban remains the authoritative gate.
            return {
                "warning": {
                    "title": _("IBAN check"),
                    "message": _(
                        "IBANforge reports this IBAN as invalid. You can still "
                        "save it; format validation is enforced on save."
                    ),
                }
            }

        self.ibanforge_info = self._ibanforge_build_info(data)

        bic = data.get("bic") or {}
        bic_code = bic.get("code")
        if not bic_code:
            # Valid IBAN but no BIC found: leave bank_id untouched.
            return

        bank = self._ibanforge_find_bank(bic_code)
        if bank:
            # Existing bank: link it (related fields fill bank_name/bank_bic).
            self.bank_id = bank
        else:
            # Unknown bank: only show the detected values. We must NOT create a
            # res.bank inside an onchange (it would orphan records the user may
            # discard). Persistence happens in _ibanforge_apply_to_record.
            self.ibanforge_detected_bic = bic_code
            self.ibanforge_detected_bank_name = bic.get("bank_name") or bic_code

    # ------------------------------------------------------------------
    # Authoritative persistence
    # ------------------------------------------------------------------
    def _ibanforge_apply_to_record(self):
        """Find-or-create the res.bank and link it on each eligible record.

        Eligible = IBAN account, an account number set, and no bank_id yet. A
        bank_id chosen manually by the user is never overwritten.
        """
        Bank = self.env["res.bank"]
        for record in self:
            if record.acc_type != "iban" or not record.acc_number:
                continue
            if record.bank_id:
                # Respect a manually (or already) set bank.
                continue

            data = record._ibanforge_lookup(record.acc_number)
            if not data or data.get("valid") is False:
                continue

            bic = data.get("bic") or {}
            bic_code = bic.get("code")
            if not bic_code:
                continue

            bank = record._ibanforge_find_bank(bic_code)
            if not bank:
                bank = Bank.create(
                    {
                        "name": bic.get("bank_name") or bic_code,
                        "bic": bic_code,
                    }
                )
            record.bank_id = bank.id

    # ------------------------------------------------------------------
    # ORM overrides
    # ------------------------------------------------------------------
    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        # Skip during our own write-back to avoid re-entrancy.
        if not self.env.context.get("ibanforge_skip_autofill"):
            records.with_context(
                ibanforge_skip_autofill=True
            )._ibanforge_apply_to_record()
        return records

    def write(self, vals):
        res = super().write(vals)
        # Only react when the IBAN itself changed, and never recurse into our
        # own bank_id write-back.
        if "acc_number" in vals and not self.env.context.get(
            "ibanforge_skip_autofill"
        ):
            self.with_context(
                ibanforge_skip_autofill=True
            )._ibanforge_apply_to_record()
        return res
