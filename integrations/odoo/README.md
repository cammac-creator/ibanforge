# IBANforge for Odoo

`ibanforge_bank_autofill/` is an Odoo 18 module (AGPL-3): fill the BIC and the bank name on a
partner bank account the moment an IBAN is typed, through the IBANforge API. Details, value
against native Odoo and the OCA module, configuration: [`ibanforge_bank_autofill/README.rst`](ibanforge_bank_autofill/README.rst).

## Test it (no network, no key: the tests mock the API)

```bash
docker compose -f docker-compose.test.yml up -d db
docker compose -f docker-compose.test.yml run --rm odoo \
  odoo -d testdb -i ibanforge_bank_autofill \
  --test-enable --test-tags /ibanforge_bank_autofill \
  --stop-after-init --without-demo=all --log-level=test
```

Last run: 7 October 2026, Odoo 18.0 (image `odoo:18`, build 18.0-20260926), `0 failed, 0 error(s) of 10 tests`.

## Publish on the Odoo Apps store (maintainer)

The store pulls modules from a git repository over SSH. Every branch named after an Odoo
version (`18.0`) is scanned, and each folder that holds a `__manifest__.py` at the root of
that branch is a listing. The module therefore lives in a dedicated public repository where
the `ibanforge_bank_autofill/` folder sits at the root:
<https://github.com/cammac-creator/ibanforge-odoo>, branch `18.0` (a copy of this folder,
refreshed with `git subtree`, see below).

1. On [apps.odoo.com](https://apps.odoo.com/apps/upload), sign in, then *Add repository* and
   enter the repository address followed by the branch, in the form the upload page documents:
   `ssh://git@github.com/cammac-creator/ibanforge-odoo.git#18.0`.
2. Odoo's upload page tells GitHub users to authorize the `online-odoo` user on the repository.
   On a *public* repository this should not be needed (community answers only mention it for
   private ones). If the first scan says the repository cannot be read, add that user.
3. Odoo scans the branch. The listing takes its text from `static/description/index.html`, its
   icon from `static/description/icon.png`, and its images from the `images` key of the
   manifest (the first one, `banner.png`, is the cover). Re-scan from the vendor dashboard,
   *Repositories*, after every push.
4. Price: free (no `price` and no `currency` key in the manifest). AGPL-3 is fragile for a paid
   listing; the module is a door to the API, not the product.
5. The store's rules apply (see the upload page): no code downloaded or launched, nothing
   undocumented, and a module that sends data out must say what and link the privacy policy
   (done in the Privacy section of `index.html`). Support is expected: `support@ibanforge.com`.

## Refresh the dedicated repository after a change here

Run from the main checkout, after the change is merged into `main`:

```bash
git -C ~/ibanforge subtree split --prefix=integrations/odoo -b odoo-18.0
git -C ~/ibanforge push -f git@github.com:cammac-creator/ibanforge-odoo.git odoo-18.0:18.0
git -C ~/ibanforge branch -D odoo-18.0
```
