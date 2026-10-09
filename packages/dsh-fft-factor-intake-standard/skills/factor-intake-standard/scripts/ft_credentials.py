"""Resolve the FTShare API key the way DSH itself resolves credentials.

DSH stores credentials in `$DSH_HOME/.credentials.yaml` (the file the FTShare
settings page writes through) and layers them against the environment:

```text
inherited process environment      (read-only, wins)
> $DSH_HOME/.credentials.yaml      (provider-managed, writable)
> <invocation cwd>/.env            (read-only fallback)
> $DSH_HOME/.env                   (read-only fallback)
```

The harness loads both `.env` layers into the host process environment before a
plugin runs, so a child process only has to consult two layers: the inherited
environment, then the credentials document. This module resolves the document
without importing anything the skill does not already need, and it refuses to
guess: a document it cannot prove it understands is reported rather than read
partially, because a silently skipped entry reads as "the key I stored has no
effect".
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

CREDENTIALS_FILENAME = ".credentials.yaml"
DOCUMENT_VERSION = 1
API_KEY_NAME = "FTSHARE_API_KEY"
GROUP_OTHER_BITS = 0o077
_REF_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(\S.*?)[ \t]*$")


class CredentialError(RuntimeError):
    """The credentials document exists but cannot be trusted or parsed."""


def dsh_home() -> Path:
    """Harness home: `DSH_HOME` when set, else the documented `~/.dsh`."""
    explicit = (os.environ.get("DSH_HOME") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    return Path.home() / ".dsh"


def credentials_document(dsh_home_dir: Path | None = None) -> Path:
    return (dsh_home_dir or dsh_home()) / CREDENTIALS_FILENAME


def _assert_owner_only(path: Path) -> None:
    """Refuse a document any other OS user can read, mirroring the provider.

    The provider creates the file at `0600`; a hand-written one carries whatever
    umask produced it. Silently serving a key out of a world-readable file would
    make that guarantee meaningless. Windows has no POSIX mode to inspect, so the
    check is skipped there rather than faked.
    """
    if sys.platform == "win32":
        return
    mode = path.stat().st_mode & 0o777
    if mode & GROUP_OTHER_BITS:
        raise CredentialError(
            f"{path} is readable beyond its owner (mode {mode:o});"
            f' run "chmod 600 {path}" before retrying'
        )


def _strip_scalar(raw: str) -> str:
    """Return a plain string scalar, or "" for anything this parser cannot vouch for."""
    text = raw.strip()
    if not text or text[0] in "|>&*!@`{}[]":
        return ""
    if text[0] in "'\"":
        if len(text) < 2 or text[-1] != text[0]:
            return ""
        return text[1:-1]
    if text.endswith(":") or text.endswith("#"):
        return ""
    if ": " in text:
        return ""
    return text


def _parse_document(text: str, name: str) -> dict[str, str]:
    """Minimal strict reader for the version-1 refs section.

    Validates the same invariants the harness parser enforces — a document
    version it knows, no unknown top-level key — and returns only the entries it
    can prove are plain string scalars. An ambiguous document yields no entry
    for that name instead of a guessed one.
    """
    lines = text.replace("\r\n", "\n").split("\n")
    scalar_lines = [line for line in lines if line.strip() and not line.lstrip().startswith("#")]
    if not scalar_lines:
        return {}

    version: str | None = None
    refs_indent: int | None = None
    refs: dict[str, str] = {}
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        body = line.strip()
        if indent == 0:
            refs_indent = None
            if body.startswith("version:"):
                version = _strip_scalar(body[len("version:"):])
            elif body.startswith("refs:"):
                refs_indent = indent
            elif body.startswith("records:"):
                continue
            else:
                raise CredentialError(f"{name}: unknown top-level key in credentials document")
            continue
        if refs_indent is None or indent <= refs_indent:
            continue
        if indent != refs_indent + 2:
            # Nested structure under a ref (or anything unexpected): not a flat entry.
            continue
        match = _REF_LINE.match(body)
        if match is None:
            continue
        value = _strip_scalar(match.group(2))
        if value:
            refs[match.group(1)] = value

    if version is None:
        raise CredentialError(
            f"{name}: credentials document has no version; expected version {DOCUMENT_VERSION}"
        )
    if version != str(DOCUMENT_VERSION):
        raise CredentialError(
            f"{name}: credentials document declares version {version};"
            f" this skill reads version {DOCUMENT_VERSION}"
        )
    return refs


def read_credentials_document(path: Path) -> dict[str, str]:
    """Read one credentials document, refusing one that cannot be trusted."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    _assert_owner_only(path)
    return _parse_document(text, str(path))


def _document_api_key(path: Path) -> str:
    refs = read_credentials_document(path)
    if refs:
        return refs.get(API_KEY_NAME, "")
    # A document the minimal reader declined may still be valid YAML (quoted or
    # flow-style scalars). Fall back to a real parser when the environment has
    # one, and keep the same loud stance on a document we still cannot read.
    try:
        import yaml  # type: ignore[import-not-found]
    except Exception:
        return ""
    try:
        parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a refusal
        raise CredentialError(f"{path}: credentials document is not valid YAML: {exc}") from exc
    if not isinstance(parsed, dict):
        raise CredentialError(f"{path}: credentials document must be a mapping")
    if parsed.get("version") != DOCUMENT_VERSION:
        raise CredentialError(
            f"{path}: credentials document declares version {parsed.get('version')!r};"
            f" this skill reads version {DOCUMENT_VERSION}"
        )
    refs = parsed.get("refs")
    if not isinstance(refs, dict):
        return ""
    value = refs.get(API_KEY_NAME)
    return value.strip() if isinstance(value, str) else ""


def resolve_api_key(
    *,
    explicit: str | None = None,
    key_file: str | None = None,
    cred_file: str | None = None,
) -> tuple[str, str]:
    """Resolve the key by DSH's own precedence.

    Returns `(key, source)` where source is one of `explicit`, `env`,
    `credentials`, `key-file`, or `none`.
    """
    if explicit and explicit.strip():
        return explicit.strip(), "explicit"

    env = (os.environ.get(API_KEY_NAME) or "").strip()
    if env:
        return env, "env"

    document = Path(cred_file).expanduser() if cred_file else credentials_document()
    document_key = _document_api_key(document)
    if document_key:
        return document_key, "credentials"

    override = (key_file or os.environ.get("FTSHARE_API_KEY_FILE") or "").strip()
    if override:
        path = Path(override).expanduser()
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            text = ""
        if text.strip():
            return text.strip().splitlines()[0].strip(), "key-file"

    return "", "none"


def describe_api_key(*, cred_file: str | None = None) -> dict:
    """Report whether a key is reachable and from where, without exposing it."""
    document = Path(cred_file).expanduser() if cred_file else credentials_document()
    key, source = resolve_api_key(cred_file=cred_file)
    return {
        "configured": bool(key),
        "source": source,
        "credentials_file": str(document),
        "credentials_file_present": document.is_file(),
        "length": len(key),
    }
