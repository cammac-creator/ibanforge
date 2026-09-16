"""Produit le ZIP téléchargeable depuis les sources et actualise les trois recettes."""
from pathlib import Path
import hashlib
import io
import re
import zipfile

root = Path(__file__).resolve().parents[2]
destination = root / 'frontend/public/integrations'
destination.mkdir(parents=True, exist_ok=True)
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('Code.gs', 'Sidebar.html', 'appsscript.json'):
        entry = zipfile.ZipInfo(name, date_time=(2026, 9, 16, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, (Path(__file__).parent / name).read_bytes())
body = buffer.getvalue()
name = 'ibanforge-sheets-' + hashlib.sha256(body).hexdigest()[:12] + '.zip'
(destination / name).write_bytes(body)
for locale in ('fr', 'en', 'de'):
    recipe = root / f'frontend/content/{locale}/docs/recipes.mdx'
    recipe.write_text(re.sub(r'ibanforge-sheets-[a-f0-9]{12}\.zip', name, recipe.read_text()))
# Les anciennes versions peuvent rester en cache ; leurs anciennes URL ne sont plus proposées.
for old in destination.glob('ibanforge-sheets-*.zip'):
    if old.name != name:
        old.unlink()
print(name)
