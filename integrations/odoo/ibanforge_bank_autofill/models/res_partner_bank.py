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
        if not iban or requests is None:
            return None

        get_param = self.env["ir.config_parameter"].sudo().get_param
        api_key = get_param("ibanforge.api_key")
        if not api_key:
            # No key configured: stay completely offline (no network call).
            return None

        base_url = (get_param("ibanforge.base_url") or DEFAULT_BASE_URL).rstrip("/")
        url = "%s/v1/iban/validate" % base_url

        try:
            response = requests.post(
                url,
                headers={"X-API-Key": api_key},
                json={"iban": iban},
                timeout=LOOKUP_TIMEOUT,
            )
            if response.status_code >= 400:
                _logger.debug(
                    "IBANforge lookup returned HTTP %s for %s",
                    response.status_code,
                    url,
                )
                return None
            return response.json()
        except requests.RequestException as err:
            _logger.debug("IBANforge lookup network error: %s", err)
            return None
        except Exception as err:  # noqa: BLE001 - never let a lookup break Odoo
            _logger.debug("IBANforge lookup unexpected error: %s", err)
            return None

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

        data = self._ibanforge_lookup(self.acc_number)
        if data is None:
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
