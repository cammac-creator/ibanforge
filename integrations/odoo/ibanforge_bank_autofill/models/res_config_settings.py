# Part of IBANforge Bank Auto-fill. See LICENSE file for full copyright and licensing details.

from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    ibanforge_api_key = fields.Char(
        string="IBANforge API Key",
        config_parameter="ibanforge.api_key",
        help="Your IBANforge API key. Get a free key (200 requests/month) at "
        "https://ibanforge.com.",
    )
    ibanforge_base_url = fields.Char(
        string="IBANforge Base URL",
        config_parameter="ibanforge.base_url",
        default="https://api.ibanforge.com",
        help="Base URL of the IBANforge API. Leave the default unless you use "
        "a dedicated or self-hosted endpoint.",
    )
    ibanforge_enable_risk_badge = fields.Boolean(
        string="Show SEPA / risk badge",
        config_parameter="ibanforge.enable_risk_badge",
        default=True,
        help="Display SEPA reachability and country-risk indicators next to "
        "the account when available.",
    )
