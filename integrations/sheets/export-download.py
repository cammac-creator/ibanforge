"""Produire le kit, actualiser recettes et guides, conserver les anciennes URL."""
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
references = []
for locale in ('fr', 'en', 'de'):
    for relative in ('docs/recipes.mdx', 'blog/2026-09-29-check-iban-list-google-sheets.mdx'):
        page = root / f'frontend/content/{locale}/{relative}'
        updated, count = re.subn(r'ibanforge-sheets-[a-f0-9]{12}\.zip', name, page.read_text())
        if count == 0:
            raise ValueError(f'Référence au kit introuvable : {page}')
        references.append((page, updated))
archive_path = destination / name
if archive_path.exists() and archive_path.read_bytes() != body:
    raise ValueError(f'Archive à empreinte déjà présente avec un contenu différent : {archive_path}')
archive_path.write_bytes(body)
for page, updated in references:
    page.write_text(updated)
# Une ancienne page en cache conserve son téléchargement ; ne jamais effacer l'ancien ZIP ici.
print(name)
