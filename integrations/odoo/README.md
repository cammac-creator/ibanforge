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

Last run: 2 September 2026, Odoo 18 image, `0 failed, 0 error(s) of 10 tests`.

## Publish on the Odoo Apps store (maintainer, one time)

The store pulls modules from a git repository over SSH; every branch named after an Odoo
version is scanned and each folder with a `__manifest__.py` at the root of that branch is a
listing. The module therefore lives in a dedicated repository where it sits at the root:
<https://github.com/cammac-creator/ibanforge-odoo>, branch `18.0` (a copy of this folder,
refreshed with `git subtree`).

1. On [apps.odoo.com](https://apps.odoo.com/apps/upload), sign in, **Add repository**, paste
   `git@github.com:cammac-creator/ibanforge-odoo.git#18.0`.
2. Odoo shows a public SSH key for your account: add it on GitHub as a read-only **deploy key**
   of `ibanforge-odoo` (repository → Settings → Deploy keys).
3. Odoo scans the branch within minutes. The listing takes its text from
   `static/description/index.html`, its icon from `static/description/icon.png`, and its
   screenshots from the `images` key of the manifest.
4. Price: free (AGPL-3 is fragile for a paid listing; the module is a door to the API, not
   the product).

## Refresh the dedicated repository after a change here

```bash
cd ~/ibanforge
git subtree split --prefix=integrations/odoo -b odoo-18.0
git push -f git@github.com:cammac-creator/ibanforge-odoo.git odoo-18.0:18.0
git branch -D odoo-18.0
```
