# Part of IBANforge Bank Auto-fill. See LICENSE file for full copyright and licensing details.
{
    "name": "IBANforge Bank Auto-fill",
    "version": "18.0.1.0.0",
    "category": "Accounting",
    "summary": "Auto-fill BIC and bank name from an IBAN via the IBANforge API",
    "description": """
IBANforge Bank Auto-fill
========================

Automatically fill the BIC (SWIFT) code and bank name on a partner bank
account as soon as an IBAN is entered, using the IBANforge API
(121k+ BIC codes, 75 countries). No manual bank pre-configuration required.
""",
    "author": "IBANforge",
    "website": "https://ibanforge.com/?utm_source=odoo",
    "license": "AGPL-3",
    "depends": [
        "base",
        "base_iban",
    ],
    "external_dependencies": {
        "python": ["requests"],
    },
    "data": [
        "views/res_config_settings_views.xml",
        "views/res_partner_bank_views.xml",
    ],
    # NOTE: static/description/icon.{svg,png} both ship (140x140). Before the
    # Odoo App Store upload, add real Odoo screenshots and an "images" key for
    # the listing carousel.
    "installable": True,
    "application": False,
    "auto_install": False,
}
