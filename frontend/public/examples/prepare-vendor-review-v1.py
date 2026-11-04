#!/usr/bin/env python3
"""Préparer une revue de coordonnées fournisseurs, sans modifier le fichier source.

Python 3.9+, bibliothèque standard uniquement. Le CSV UTF-8 doit porter une
colonne iban ; bic et bank_name sont facultatives. IBANFORGE_API_KEY vient de
l'environnement. Aucun achat, aucune relance réseau et aucune écriture ERP.
"""

import argparse
import csv
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "https://api.ibanforge.com/v1/iban/batch"
BATCH_SIZE = 100  # Limite du contrat POST /v1/iban/batch.


class ReviewError(ValueError):
    """Message contrôlé, sans clé ni contenu de fiche fournisseur."""


def normalize(value):
    return re.sub(r"[\s-]", "", value).upper()


def classify(row, result):
    """Une proposition reste à relire : aucune catégorie ne vaut accord de payer."""
    if type(result.get("valid")) is not bool:
        raise ReviewError("Réponse sans verdict valide : revue interrompue.")
    if result["valid"] is False:
        return "ask_supplier", "invalid_iban", None
    check = result.get("bank_code_check") or {}
    checks = result.get("checks") or {}
    bic = result.get("bic") or {}
    if not all(isinstance(block, dict) for block in (check, checks, bic)):
        raise ReviewError("Réponse inattendue : revue interrompue.")
    if checks.get("national_check_digits") == "fail":
        return "ask_supplier", "national_check_failed", None
    if (check.get("status") == "not_in_register"
            and check.get("authoritative") is True
            and check.get("reason") == "not_allocated"):
        return "ask_supplier", "bank_code_not_allocated", None
    if check.get("retired") is True:
        return "review", "retired_code_no_automatic_replacement", None
    if (check.get("status") != "verified"
            or check.get("authoritative") is not True
            or result.get("bank_code_holder") != "confirmed"
            or checks.get("bank_code") != "pass"
            or checks.get("bic") != "pass"
            or bic.get("authoritative") is not True
            or bic.get("basis") != "national_register"
            or not isinstance(bic.get("code"), str)
            or not re.fullmatch(r"[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?", bic["code"])):
        return "review", "insufficient_reference_evidence", None
    # Conserver les sources et leurs dates dans result, même pour une proposition.
    if not all(isinstance(value, str) and value.strip() for value in (
            check.get("register"), check.get("as_of"), bic.get("source"), bic.get("as_of"))):
        return "review", "missing_source_or_date", None
    previous = row.get("bic", "").strip().upper()
    if previous and previous != bic["code"]:
        return "review", "existing_bic_differs", None
    proposal = {}
    if not previous:
        proposal["bic"] = bic["code"]
    if not row.get("bank_name", "").strip() and isinstance(bic.get("bank_name"), str):
        if bic["bank_name"].strip():
            proposal["bank_name"] = bic["bank_name"]
    if not proposal:
        return "review", "no_missing_field_to_propose", None
    return "enrichment_proposal", "register_fields_for_review", proposal


def prepare(rows, fetch_batch):
    review = []
    pending = []
    for index, row in enumerate(rows, start=1):
        entry = {"record": index, "original": dict(row), "decision": "review",
                 "reason": "missing_iban", "proposal": None, "result": None}
        review.append(entry)
        iban = row["iban"]
        if not normalize(iban):
            continue
        if len(iban) > 64:
            entry["reason"] = "input_too_long"
            continue
        pending.append(entry)
    for start in range(0, len(pending), BATCH_SIZE):
        batch = pending[start:start + BATCH_SIZE]
        payload = fetch_batch([entry["original"]["iban"] for entry in batch])
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list) or len(results) != len(batch):
            raise ReviewError("Nombre de résultats incohérent : revue interrompue.")
        # Vérifier chaque correspondance, pas seulement la longueur du lot.
        for entry, result in zip(batch, results):
            if (not isinstance(result, dict) or not isinstance(result.get("iban"), str)
                    or normalize(result["iban"]) != normalize(entry["original"]["iban"])):
                raise ReviewError("Ordre ou IBAN incohérent : revue interrompue.")
            decision, reason, proposal = classify(entry["original"], result)
            entry.update(decision=decision, reason=reason, proposal=proposal, result=result)
    return review


def load_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        if "iban" not in columns or len(columns) != len(set(columns)) or "" in columns:
            raise ReviewError("Colonnes CSV invalides : une colonne unique iban est obligatoire.")
        rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ReviewError("Nombre de colonnes incohérent dans le CSV.")
    return rows


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # Une redirection ne doit jamais transporter la clé vers un autre hôte.
        return None


def call_api(ibans, key):
    request = Request(API, method="POST", data=json.dumps({"ibans": ibans}).encode(),
                      headers={"Authorization": f"Bearer {key}",
                               "Content-Type": "application/json",
                               "User-Agent": "IBANforge-vendor-review/1"})
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.output.exists() or args.output.is_symlink():
            raise ReviewError("Le fichier de sortie existe déjà ; aucun appel effectué.")
        key = os.environ.get("IBANFORGE_API_KEY", "").strip()
        if not key:
            raise ReviewError("La variable IBANFORGE_API_KEY manque ; aucun appel effectué.")
        rows = load_rows(args.source)
        review = prepare(rows, lambda ibans: call_api(ibans, key))
        # Pas de sortie partielle si un lot échoue. Ne jamais écraser un fichier.
        payload = json.dumps({"version": 1, "payment_authorized": False, "rows": review},
                             ensure_ascii=False, indent=2) + "\n"
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
        counts = {name: sum(row["decision"] == name for row in review)
                  for name in ("enrichment_proposal", "review", "ask_supplier")}
        print(json.dumps({"records": len(review), "decisions": counts}))
        return 0
    except HTTPError as error:
        print(f"API HTTP {error.code} : arrêt sans relance automatique.", file=sys.stderr)
        error.close()
    except (URLError, TimeoutError):
        print("API injoignable : arrêt sans relance automatique.", file=sys.stderr)
    except ReviewError as error:
        print(str(error), file=sys.stderr)
    except (ValueError, OSError, csv.Error):
        # Les messages des bibliothèques peuvent contenir une clé ou une ligne.
        print("Lecture, réponse ou écriture impossible : revue interrompue.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
