"""Focused tests for the DSH credential resolution used by the skill scripts.

Run through `node --test tests/python.test.mjs` so the package keeps one test
runner.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ft_credentials  # noqa: E402


def write_document(text: str, mode: int = 0o600) -> Path:
    directory = Path(tempfile.mkdtemp())
    path = directory / ".credentials.yaml"
    path.write_text(text, encoding="utf-8")
    os.chmod(path, mode)
    return path


class DocumentParsing(unittest.TestCase):
    def test_reads_a_plain_reference(self) -> None:
        path = write_document(
            'version: 1\nrefs:\n  FTSHARE_API_KEY: sk-test-123\n  OTHER_KEY: x\nrecords:\n'
        )
        self.assertEqual(ft_credentials.read_credentials_document(path)["FTSHARE_API_KEY"], "sk-test-123")

    def test_reads_a_quoted_reference(self) -> None:
        path = write_document('version: 1\nrefs:\n  FTSHARE_API_KEY: "sk-quoted"\n')
        self.assertEqual(ft_credentials.read_credentials_document(path)["FTSHARE_API_KEY"], "sk-quoted")

    def test_ignores_nested_structures_under_a_record(self) -> None:
        path = write_document(
            "version: 1\nrefs:\n  FTSHARE_API_KEY: sk-1\nrecords:\n"
            "  client-connection/browser-session:\n    kind: x\n    payload:\n      secret: y\n"
        )
        refs = ft_credentials.read_credentials_document(path)
        self.assertEqual(refs, {"FTSHARE_API_KEY": "sk-1"})

    def test_rejects_an_unknown_document_version(self) -> None:
        path = write_document("version: 2\nrefs:\n  FTSHARE_API_KEY: sk-1\n")
        with self.assertRaises(ft_credentials.CredentialError):
            ft_credentials.read_credentials_document(path)

    def test_rejects_a_missing_version(self) -> None:
        path = write_document("refs:\n  FTSHARE_API_KEY: sk-1\n")
        with self.assertRaises(ft_credentials.CredentialError):
            ft_credentials.read_credentials_document(path)

    def test_rejects_an_unknown_top_level_key(self) -> None:
        path = write_document("version: 1\nextras:\n  FTSHARE_API_KEY: sk-1\n")
        with self.assertRaises(ft_credentials.CredentialError):
            ft_credentials.read_credentials_document(path)

    @unittest.skipIf(sys.platform == "win32", "POSIX mode check")
    def test_rejects_a_group_readable_document(self) -> None:
        path = write_document("version: 1\nrefs:\n  FTSHARE_API_KEY: sk-1\n", mode=0o644)
        with self.assertRaises(ft_credentials.CredentialError):
            ft_credentials.read_credentials_document(path)

    def test_missing_document_is_not_an_error(self) -> None:
        self.assertEqual(ft_credentials.read_credentials_document(Path("/nonexistent/.credentials.yaml")), {})


class Precedence(unittest.TestCase):
    def setUp(self) -> None:
        self.previous = os.environ.pop(ft_credentials.API_KEY_NAME, None)

    def tearDown(self) -> None:
        os.environ.pop(ft_credentials.API_KEY_NAME, None)
        if self.previous is not None:
            os.environ[ft_credentials.API_KEY_NAME] = self.previous

    def test_environment_wins_over_the_document(self) -> None:
        document = write_document("version: 1\nrefs:\n  FTSHARE_API_KEY: from-document\n")
        os.environ[ft_credentials.API_KEY_NAME] = "from-env"
        key, source = ft_credentials.resolve_api_key(cred_file=str(document))
        self.assertEqual((key, source), ("from-env", "env"))

    def test_document_wins_over_the_key_file(self) -> None:
        document = write_document("version: 1\nrefs:\n  FTSHARE_API_KEY: from-document\n")
        key_file = Path(tempfile.mkdtemp()) / "key"
        key_file.write_text("from-file\n", encoding="utf-8")
        key, source = ft_credentials.resolve_api_key(cred_file=str(document), key_file=str(key_file))
        self.assertEqual((key, source), ("from-document", "credentials"))

    def test_key_file_is_the_last_resort(self) -> None:
        empty = write_document("version: 1\nrefs:\n  OTHER_KEY: x\n")
        key_file = Path(tempfile.mkdtemp()) / "key"
        key_file.write_text("from-file\nsecond-line\n", encoding="utf-8")
        key, source = ft_credentials.resolve_api_key(cred_file=str(empty), key_file=str(key_file))
        self.assertEqual((key, source), ("from-file", "key-file"))

    def test_reports_none_when_nothing_is_configured(self) -> None:
        empty = write_document("version: 1\nrefs:\n  OTHER_KEY: x\n")
        key, source = ft_credentials.resolve_api_key(cred_file=str(empty), key_file="/nonexistent/key")
        self.assertEqual((key, source), ("", "none"))


if __name__ == "__main__":
    unittest.main()