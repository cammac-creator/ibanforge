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
bank name from a database of 121,000+ BIC entries across 89 IBAN countries, and this
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

+-------------------------------+----------------------+-----------------------------+----------------------------+
| Capability                    | Native ``base_iban`` | OCA ``base_bank_from_iban`` | This module                |
+===============================+======================+=============================+============================+
| Validate IBAN format (mod-97) | Yes                  | Yes                         | Delegated to ``base_iban`` |
+-------------------------------+----------------------+-----------------------------+----------------------------+
| Fill the BIC                  | No                   | No                          | Yes (via API)              |
+-------------------------------+----------------------+-----------------------------+----------------------------+
| Fill the bank name            | No                   | Only if bank pre-configured | Yes (find-or-create)       |
+-------------------------------+----------------------+-----------------------------+----------------------------+
| Worldwide BIC database        | No                   | No (manual local mapping)   | Yes (121k+ BIC entries)    |
+-------------------------------+----------------------+-----------------------------+----------------------------+
| SEPA / risk / CH clearing     | No                   | No                          | Yes (info badge)           |
+-------------------------------+----------------------+-----------------------------+----------------------------+

The gap: ``base_bank_from_iban`` can only match a bank if you have already
created it with its code. Nobody pre-configures 121,000 BIC entries. IBANforge
does it in one call, with no setup.

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

#. Get a **free API key** at
   `ibanforge.com <https://ibanforge.com/docs/api-keys?utm_source=odoo>`_:
   200 requests a month once you give an e-mail address, 25 a month without one.
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

Known limitations (MVP)
=======================

* **Changing an IBAN on an existing account** does not relink the bank if a
  bank is already set: the existing ``bank_id`` is preserved (so a manually
  chosen bank is never lost). Clear the bank field to re-trigger detection.
* **Two API calls per new account via the UI**: one on change (instant
  feedback) and one on save (authoritative). With a 200/month free key this
  consumes roughly twice per manually entered account. Imports and API-created
  records only call once (on ``create``).

Privacy
=======

**With no API key saved, nothing leaves your server**: the module makes no
network call at all.

Once a key is saved, the module sends two things over HTTPS to
``https://api.ibanforge.com`` (or to the API Base URL you set):

* the IBAN typed in the Account Number field of a partner bank account (while
  you edit it, then again when the account is saved or its IBAN changes,
  imports included);
* your API key, in an ``X-API-Key`` header.

Nothing else is sent: no partner name, no address, no other Odoo field. What
comes back is the BIC, the bank name and the SEPA and risk indicators for that
IBAN.

The `IBANforge privacy policy <https://ibanforge.com/legal/privacy>`_ states
that IBANs submitted for validation are processed in memory and are not stored,
with one exception: for an invalid IBAN, at most its first 4 characters (country
code and check digits, never the bank or account part) are kept, up to 12
months, as request metadata. The module sends the IBAN in the body of the
request, never in a URL.

The hosting side also sees the address of your Odoo server: according to the
same policy, the network edge of the API host keeps the raw IP address and the
request path for 7 days, outside IBANforge's own logs, which keep only a salted
hash of the address. Each call is counted against the monthly allowance of your
key. A `data processing agreement <https://ibanforge.com/legal/dpa>`_ is
available.
An IBAN can be personal data: you stay in charge of what you enter in Odoo and
of whether you enable the lookup.

The module itself collects no usage statistics, has no telemetry, downloads no
code and runs no other code.

Support
=======

Questions, a bug or a request: support@ibanforge.com. Source code and issues:
https://github.com/cammac-creator/ibanforge-odoo

License
=======

AGPL-3. See the ``LICENSE`` file.
