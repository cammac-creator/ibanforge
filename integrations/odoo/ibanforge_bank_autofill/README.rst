========================
IBANforge Bank Auto-fill
========================

.. |badge1| image:: https://img.shields.io/badge/licence-AGPL--3-blue.png
    :target: https://www.gnu.org/licenses/agpl-3.0-standalone.html
    :alt: License: AGPL-3

|badge1|

Automatically fill the **BIC (SWIFT) code** and the **bank name** on a partner
bank account the moment an IBAN is entered, using the `IBANforge
<https://ibanforge.com/?utm_source=odoo>`_ API.

No manual bank pre-configuration is required: IBANforge resolves the BIC and
bank name from a database of 121,000+ BIC codes across 75 countries, and this
module creates (or reuses) the matching ``res.bank`` record for you.

What it does
============

* On IBAN entry on ``res.partner.bank``, calls the IBANforge ``validate``
  endpoint.
* Auto-fills the BIC and bank name by linking a ``res.bank`` record
  (find-or-create by BIC, case-insensitive, no duplicates).
* Shows a **non-blocking warning** if the IBAN looks invalid or the API is
  unavailable. The module **never** blocks entering or saving an account.
* Optionally shows a SEPA reachability / country-risk badge (toggle in
  Settings).

Value vs. native Odoo
=====================

+--------------------------------+---------------------+--------------------------------+--------------------+
| Capability                     | Native ``base_iban``| OCA ``base_bank_from_iban``    | This module        |
+================================+=====================+================================+====================+
| Validate IBAN format (mod-97)  | Yes                 | Yes                            | Delegated to       |
|                                |                     |                                | ``base_iban``      |
+--------------------------------+---------------------+--------------------------------+--------------------+
| Fill the BIC                   | No                  | No                             | Yes (via API)      |
+--------------------------------+---------------------+--------------------------------+--------------------+
| Fill the bank name             | No                  | Only if bank pre-configured    | Yes (find-or-create)|
+--------------------------------+---------------------+--------------------------------+--------------------+
| Worldwide BIC database         | No                  | No (manual local mapping)      | Yes (121k+ BIC)    |
+--------------------------------+---------------------+--------------------------------+--------------------+
| SEPA / risk / CH clearing      | No                  | No                             | Yes (info badge)   |
+--------------------------------+---------------------+--------------------------------+--------------------+

The gap: ``base_bank_from_iban`` can only match a bank if you have already
created it with its code. Nobody pre-configures 121,000 banks. IBANforge does
it in one call, with no setup.

Installation
============

This module requires the Python ``requests`` library (almost always already
present on an Odoo server)::

    pip install requests

Then install the module from the Apps menu (technical name:
``ibanforge_bank_autofill``). It depends on ``base`` and ``base_iban``
(both shipped with Odoo).

Configuration
=============

#. Get a **free API key** (200 requests/month) at
   `ibanforge.com <https://ibanforge.com/?utm_source=odoo>`_.
#. Open **Settings → IBANforge** and paste your API key.
#. (Optional) Adjust the API base URL and toggle the SEPA / risk badge.

Without a key, the module stays completely offline and makes no network
call: account entry and saving work exactly as in stock Odoo.

How it works
============

* **On change** of the IBAN field: an instant lookup links an existing
  ``res.bank`` if one matches the BIC, otherwise it shows the detected BIC and
  bank name. It never creates a record at this stage (no orphans on a
  discarded form).
* **On save** (``create`` / ``write``): the authoritative step finds or
  creates the ``res.bank`` by BIC and links it via ``bank_id``. A bank you set
  manually is never overwritten.

Privacy
=======

When an API key is configured, the IBAN you enter is sent over HTTPS to the
configured IBANforge endpoint for validation. With no key configured, nothing
leaves your server.

Icon / App Store note
=====================

This package ships both ``static/description/icon.svg`` and a 140x140
``static/description/icon.png``. Before submitting to apps.odoo.com, add real
Odoo screenshots and an ``images`` entry in ``__manifest__.py`` for the listing
carousel.

License
=======

AGPL-3. See the ``LICENSE`` file.
