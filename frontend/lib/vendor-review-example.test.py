"""Exécuter le fichier réellement proposé au téléchargement, sans réseau."""
import contextlib
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

FILE = Path(__file__).parents[1] / "public/examples/prepare-vendor-review-v1.py"
spec = importlib.util.spec_from_file_location("vendor_review", FILE)
example = importlib.util.module_from_spec(spec)
spec.loader.exec_module(example)
EXEMPLE_A = "DE00" + "0" * 18
EXEMPLE_B = "GB00" + "0" * 18


def answer(iban=EXEMPLE_A):
    # Réponses simulées : numéros volontairement fictifs, banque et source inventées.
    return {"iban": iban, "valid": True, "bank_code_holder": "confirmed",
            "checks": {"bank_code": "pass", "bic": "pass", "national_check_digits": "pass"},
            "bank_code_check": {"status": "verified", "authoritative": True,
                                "register": "Registre de démonstration", "as_of": "2026-10"},
            "bic": {"code": "DEMOAAXX", "bank_name": "Banque de démonstration",
                    "basis": "national_register", "authoritative": True,
                    "source": "Registre de démonstration", "as_of": "2026-10"}}


class ReviewTests(unittest.TestCase):
    def test_proposition_sans_mutation_et_sans_autorisation(self):
        rows = [{"iban": EXEMPLE_A, "reference": "alpha", "bic": "", "bank_name": "Nom conservé"}]
        initial = deepcopy(rows)
        result = example.prepare(rows, lambda _: {"results": [answer()]})[0]
        self.assertEqual(rows, initial)
        self.assertEqual(result["original"], initial[0])
        self.assertEqual(result["decision"], "enrichment_proposal")
        self.assertEqual(result["proposal"], {"bic": "DEMOAAXX"})
        self.assertEqual(result["result"]["bic"]["source"], "Registre de démonstration")

    def test_vide_trop_long_doublons_et_frontiere_des_lots(self):
        rows = [{"iban": EXEMPLE_A, "reference": str(i)} for i in range(101)]
        rows.insert(1, {"iban": "", "reference": "vide"})
        rows.insert(10, {"iban": "X" * 65, "reference": "long"})
        calls = []
        def fetch(ibans):
            calls.append(ibans)
            return {"results": [answer(iban) for iban in ibans]}
        review = example.prepare(rows, fetch)
        self.assertEqual([len(call) for call in calls], [100, 1])
        self.assertEqual([r["original"] for r in review], rows)
        self.assertEqual(review[1]["reason"], "missing_iban")
        self.assertEqual(review[10]["reason"], "input_too_long")
        self.assertEqual([r["record"] for r in review], list(range(1, 104)))

    def test_reponses_courtes_longues_reordonnees_ou_mal_formees(self):
        rows = [{"iban": EXEMPLE_A}, {"iban": EXEMPLE_B}]
        bad = [None, {}, {"results": []}, {"results": [answer()]},
               {"results": [answer(), answer(EXEMPLE_B), answer()]},
               {"results": [answer(EXEMPLE_B), answer()]},
               {"results": [answer(), None]},
               {"results": [{"iban": EXEMPLE_A}, answer(EXEMPLE_B)]}]
        for payload in bad:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                example.prepare(rows, lambda _: payload)

    def test_formatage_ne_change_pas_la_correspondance(self):
        review = example.prepare([{"iban": "de00-0000 0000 0000 0000 00"}],
                                 lambda _: {"results": [answer()]})
        self.assertEqual(review[0]["decision"], "enrichment_proposal")

    def test_les_incertitudes_ne_deviennent_pas_des_complements(self):
        for block, changes in [
            ("bank_code_check", {"status": "unavailable"}),
            ("bank_code_check", {"status": "not_in_register", "authoritative": False,
                                 "reason": "absent_from_reference_data"}),
            ("bank_code_check", {"retired": True, "superseded_by": "12345678"}),
            ("bank_code_check", {"as_of": ""}),
            ("bic", {"basis": "directory_prefix", "authoritative": False}),
            ("bic", {"source": None}),
            ("bic", {"code": ""}),
            ("checks", {"bank_code": "unknown"}),
        ]:
            with self.subTest(block=block, changes=changes):
                result = answer()
                result[block].update(changes)
                decision, _, proposal = example.classify({"iban": EXEMPLE_A}, result)
                self.assertEqual(decision, "review")
                self.assertIsNone(proposal)

    def test_erreurs_explicitement_a_clarifier(self):
        result = answer()
        result["valid"] = False
        self.assertEqual(example.classify({}, result)[:2], ("ask_supplier", "invalid_iban"))
        result = answer()
        result["checks"]["national_check_digits"] = "fail"
        self.assertEqual(example.classify({}, result)[:2], ("ask_supplier", "national_check_failed"))
        result = answer()
        result["bank_code_check"].update(status="not_in_register", reason="not_allocated")
        self.assertEqual(example.classify({}, result)[:2], ("ask_supplier", "bank_code_not_allocated"))
        result["bank_code_check"]["reason"] = "register_names_no_holder"
        self.assertEqual(example.classify({}, result)[0], "review")

    def test_conflit_bic_et_champs_deja_remplis(self):
        self.assertEqual(example.classify({"bic": "AUTRAAXX"}, answer())[:2],
                         ("review", "existing_bic_differs"))
        decision, _, proposal = example.classify({"bic": "DEMOAAXX"}, answer())
        self.assertEqual(decision, "enrichment_proposal")
        self.assertEqual(proposal, {"bank_name": "Banque de démonstration"})
        self.assertEqual(example.classify({"bic": "DEMOAAXX", "bank_name": "Conservé"}, answer())[0], "review")

    def test_csv_bom_et_colonnes_invalides(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            source.write_text("\ufeffiban,reference\n,alpha\n", encoding="utf-8")
            self.assertEqual(example.load_rows(source), [{"iban": "", "reference": "alpha"}])
            for content in ("bic\nX\n", "iban,iban\nx,x\n", "iban,bic\nx\n", "iban\nx,y\n"):
                source.write_text(content, encoding="utf-8")
                with self.subTest(content=content), self.assertRaises(ValueError):
                    example.load_rows(source)

    def invoke(self, source, output, fetch, key="cle-fictive"):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(example.sys, "argv", [str(FILE), str(source), str(output)]), \
                patch.dict(os.environ, {"IBANFORGE_API_KEY": key}), \
                patch.object(example, "call_api", side_effect=fetch) as call, \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = example.main()
        return code, call.call_count, stdout.getvalue(), stderr.getvalue()

    def test_cli_ecrit_un_rapport_relisible_et_conserve_la_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.csv", Path(directory) / "review.json"
            content = f"iban,reference\n{EXEMPLE_A},alpha\n,beta\n"
            source.write_text(content)
            code, calls, stdout, stderr = self.invoke(source, output, lambda *_: {"results": [answer()]})
            self.assertEqual((code, calls, stderr), (0, 1, ""))
            report = json.loads(output.read_text())
            self.assertFalse(report["payment_authorized"])
            self.assertEqual(len(report["rows"]), 2)
            self.assertEqual(source.read_text(), content)
            self.assertNotIn(EXEMPLE_A, stdout)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertEqual(self.invoke(source, output, lambda *_: self.fail("Appel inattendu"))[:2], (1, 0))

    def test_cli_aucune_sortie_partielle_ni_relance_apres_echec(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.csv", Path(directory) / "review.json"
            source.write_text("iban\n" + (EXEMPLE_A + "\n") * 101)
            calls = []
            def fetch(ibans, _key):
                calls.append(ibans)
                if len(calls) == 2:
                    raise HTTPError(example.API, 402, "Message non publié", {}, None)
                return {"results": [answer(iban) for iban in ibans]}
            code, count, stdout, stderr = self.invoke(source, output, fetch)
            self.assertEqual((code, count, stdout), (1, 2, ""))
            self.assertIn("HTTP 402", stderr)
            self.assertNotIn("Message non publié", stderr)
            self.assertFalse(output.exists())
            self.assertEqual(self.invoke(source, output, fetch, key="")[:2], (1, 0))
            def fail(*_):
                raise URLError("Erreur réseau confidentielle")
            self.assertNotIn("confidentielle", self.invoke(source, output, fail)[3])
            def header_error(*_):
                raise ValueError("Invalid header value: cle-confidentielle")
            self.assertNotIn("cle-confidentielle", self.invoke(source, output, header_error)[3])

    def test_le_transport_envoie_seulement_les_iban_et_ne_suit_pas_les_redirections(self):
        stream = io.BytesIO(b'{"results": []}')
        with patch.object(example, "build_opener") as opener:
            opener.return_value.open.return_value = stream
            self.assertEqual(example.call_api([EXEMPLE_A], "cle-fictive"), {"results": []})
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, example.API)
            self.assertEqual(json.loads(request.data), {"ibans": [EXEMPLE_A]})
            self.assertEqual(request.get_header("Authorization"), "Bearer cle-fictive")
            self.assertEqual(opener.return_value.open.call_args.kwargs["timeout"], 30)
            handler = opener.call_args.args[0]
            self.assertIsNone(handler.redirect_request(request, None, 302, "", {}, "https://example.net"))


if __name__ == "__main__":
    unittest.main()
