# Part of IBANforge Bank Auto-fill. See LICENSE file for full copyright and licensing details.

from unittest.mock import MagicMock, patch

import requests

from odoo.tests import TransactionCase, tagged

# Path to the ``requests`` symbol imported inside the model module. Patching it
# here means no real network call ever leaves the test suite.
REQUESTS_POST = (
    "odoo.addons.ibanforge_bank_autofill.models.res_partner_bank.requests.post"
)

# A real, mod-97 valid IBAN so base_iban computes acc_type == 'iban'.
VALID_IBAN = "DE89370400440532013000"


def _mock_response(payload, status_code=200):
    """Build a fake requests.Response-like object returning ``payload``."""
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload
    return response


def _valid_payload(bic_code="COBADEFF", bank_name="COMMERZBANK AG"):
    bic = None
    if bic_code is not None:
        bic = {"code": bic_code, "bank_name": bank_name, "city": "Frankfurt am Main"}
    return {
        "valid": True,
        "iban": VALID_IBAN,
        "formatted": "DE89 3704 0044 0532 0130 00",
        "country": {"code": "DE", "name": "Germany"},
        "bic": bic,
        "sepa": {"member": True, "schemes": ["SCT", "SDD", "SCT_INST"], "vop_required": True},
        "issuer": {"type": "bank", "name": bank_name},
        "risk_indicators": {
            "issuer_type": "bank",
            "country_risk": "standard",
            "test_bic": False,
            "sepa_reachable": True,
            "vop_coverage": True,
        },
        "clearing": None,
        "cost_usdc": 0.005,
    }


@tagged("post_install", "-at_install")
class TestIbanforgeAutofill(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env["res.partner"].create({"name": "Test Partner"})
        cls.Bank = cls.env["res.bank"]
        cls.PartnerBank = cls.env["res.partner.bank"]

    def setUp(self):
        super().setUp()
        # Configure a key so lookups actually run for most tests.
        self.env["ir.config_parameter"].sudo().set_param(
            "ibanforge.api_key", "test-key-200"
        )
        self.env["ir.config_parameter"].sudo().set_param(
            "ibanforge.base_url", "https://api.ibanforge.com"
        )
        self.env["ir.config_parameter"].sudo().set_param(
            "ibanforge.enable_risk_badge", "True"
        )

    # ------------------------------------------------------------------
    # 1. Valid IBAN + bic.code -> bank_id set, res.bank created
    # ------------------------------------------------------------------
    def test_01_valid_iban_creates_bank(self):
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())) as mock_post:
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        self.assertEqual(account.acc_type, "iban")
        self.assertTrue(account.bank_id, "bank_id should have been set")
        self.assertEqual(account.bank_bic, "COBADEFF")
        self.assertEqual(account.bank_name, "COMMERZBANK AG")
        self.assertTrue(mock_post.called)
        self.assertEqual(
            self.Bank.search_count([("bic", "=ilike", "COBADEFF")]),
            1,
            "exactly one res.bank should exist for this BIC",
        )

    # ------------------------------------------------------------------
    # 2. BIC already in DB -> reused, no duplicate
    # ------------------------------------------------------------------
    def test_02_existing_bic_reused(self):
        existing = self.Bank.create({"name": "Pre-existing Bank", "bic": "COBADEFF"})
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())):
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        self.assertEqual(account.bank_id, existing, "existing bank should be reused")
        self.assertEqual(
            self.Bank.search_count([("bic", "=ilike", "COBADEFF")]),
            1,
            "no duplicate res.bank should be created",
        )

    # ------------------------------------------------------------------
    # 3. bic == null -> validity OK, bank_id untouched
    # ------------------------------------------------------------------
    def test_03_null_bic_leaves_bank_empty(self):
        payload = _valid_payload(bic_code=None)
        with patch(REQUESTS_POST, return_value=_mock_response(payload)):
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        self.assertEqual(account.acc_type, "iban")
        self.assertFalse(account.bank_id, "bank_id must stay empty when bic is null")

    # ------------------------------------------------------------------
    # 4. valid == false -> onchange warning, no blocking
    # ------------------------------------------------------------------
    def test_04_invalid_iban_warns_onchange(self):
        payload = {"valid": False, "iban": VALID_IBAN, "bic": None}
        new_account = self.PartnerBank.new(
            {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
        )
        with patch(REQUESTS_POST, return_value=_mock_response(payload)):
            result = new_account._onchange_acc_number_ibanforge()
        self.assertIsInstance(result, dict)
        self.assertIn("warning", result)
        self.assertFalse(new_account.bank_id, "no bank should be linked on invalid IBAN")

    # ------------------------------------------------------------------
    # 5. No API key -> no-op, no network call at all
    # ------------------------------------------------------------------
    def test_05_no_api_key_no_network(self):
        self.env["ir.config_parameter"].sudo().set_param("ibanforge.api_key", "")
        with patch(REQUESTS_POST) as mock_post:
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        mock_post.assert_not_called()
        self.assertFalse(account.bank_id, "no lookup should happen without a key")

    # ------------------------------------------------------------------
    # 6. API timeout / error -> graceful no-op, save still succeeds
    # ------------------------------------------------------------------
    def test_06_api_error_graceful(self):
        with patch(REQUESTS_POST, side_effect=requests.exceptions.Timeout("boom")):
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        self.assertTrue(account.exists(), "record must be saved despite API error")
        self.assertFalse(account.bank_id, "no bank should be linked on API error")

    def test_06b_http_500_graceful(self):
        with patch(
            REQUESTS_POST,
            return_value=_mock_response({"error": "server"}, status_code=500),
        ):
            account = self.PartnerBank.create(
                {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
            )
        self.assertTrue(account.exists())
        self.assertFalse(account.bank_id)

    # ------------------------------------------------------------------
    # 7. Manually set bank_id -> never overwritten
    # ------------------------------------------------------------------
    def test_07_manual_bank_not_overwritten(self):
        manual_bank = self.Bank.create({"name": "My Chosen Bank", "bic": "MANUBANK"})
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())) as mock_post:
            account = self.PartnerBank.create(
                {
                    "acc_number": VALID_IBAN,
                    "partner_id": self.partner.id,
                    "bank_id": manual_bank.id,
                }
            )
        self.assertEqual(account.bank_id, manual_bank, "manual bank must be kept")
        mock_post.assert_not_called()

    # ------------------------------------------------------------------
    # Extra: write() path enriches an account whose IBAN is set later
    # ------------------------------------------------------------------
    def test_08_write_sets_bank(self):
        # Create with a non-IBAN account number first (acc_type != 'iban').
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())):
            account = self.PartnerBank.create(
                {"acc_number": "1234567890", "partner_id": self.partner.id}
            )
        self.assertFalse(account.bank_id)
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())) as mock_post:
            account.write({"acc_number": VALID_IBAN})
        self.assertTrue(mock_post.called)
        self.assertTrue(account.bank_id, "write() should auto-fill the bank")
        self.assertEqual(account.bank_bic, "COBADEFF")

    # ------------------------------------------------------------------
    # Extra: onchange links an existing bank without creating a record
    # ------------------------------------------------------------------
    def test_09_onchange_no_record_creation(self):
        before = self.Bank.search_count([])
        new_account = self.PartnerBank.new(
            {"acc_number": VALID_IBAN, "partner_id": self.partner.id}
        )
        with patch(REQUESTS_POST, return_value=_mock_response(_valid_payload())):
            new_account._onchange_acc_number_ibanforge()
        after = self.Bank.search_count([])
        self.assertEqual(before, after, "onchange must never create a res.bank")
        self.assertEqual(new_account.ibanforge_detected_bic, "COBADEFF")
        self.assertEqual(new_account.ibanforge_detected_bank_name, "COMMERZBANK AG")
        self.assertTrue(new_account.ibanforge_info, "info badge should be populated")
