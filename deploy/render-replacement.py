#!/usr/bin/env python3
"""Create new Rust Signal vhosts with the original Nginx sockets and TLS settings.

The wrapper verifies ownership of each input file before invoking this script.
This parser is deliberately conservative: complex/shared configurations fail
rather than silently changing public/private listeners or certificates.
"""
from __future__ import annotations

import glob
import os
import pathlib
import re
import shlex
import sys
from dataclasses import dataclass


class Unsafe(Exception):
    pass


@dataclass
class Directive:
    name: str
    args: list[str]
    children: list["Directive"] | None = None


def parse(text: str, filename: str) -> list[Directive]:
    lexer = shlex.shlex(text, posix=True, punctuation_chars="{};")
    lexer.whitespace_split = True
    lexer.commenters = "#"
    try:
        raw = list(lexer)
    except ValueError as exc:
        raise Unsafe(f"Bad Nginx syntax in {filename}: {exc}") from exc
    tokens = [p for tok in raw for p in
              (list(tok) if tok and all(c in "{};" for c in tok) else [tok])]
    pos = 0

    def scope(nested: bool) -> list[Directive]:
        nonlocal pos
        result: list[Directive] = []
        while pos < len(tokens):
            if tokens[pos] == "}":
                if not nested:
                    raise Unsafe(f"Unexpected }} in {filename}")
                pos += 1
                return result
            statement: list[str] = []
            while pos < len(tokens) and tokens[pos] not in ("{", "}", ";"):
                statement.append(tokens[pos])
                pos += 1
            if not statement or pos >= len(tokens) or tokens[pos] == "}":
                raise Unsafe(f"Malformed directive in {filename}")
            symbol = tokens[pos]
            pos += 1
            result.append(Directive(statement[0], statement[1:],
                                    scope(True) if symbol == "{" else None))
        if nested:
            raise Unsafe(f"Unclosed {{ in {filename}")
        return result
    return scope(False)


def nginx_line(name: str, args: list[str]) -> str:
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", name) or not args:
        raise Unsafe("Unsafe/empty Nginx directive: " + name)
    encoded = []
    for val in args:
        if any(c in val for c in "\r\n\0"):
            raise Unsafe("Unexpected newline in Nginx directive")
        if re.fullmatch(r"[a-zA-Z0-9_.$:/@+~=,!?*\[\]()-]+", val):
            encoded.append(val)
        else:
            encoded.append('"' + val.replace("\\", "\\\\").replace('"', '\\"') + '"')
    return "    " + name + " " + " ".join(encoded) + ";"


TLS_ONLY = {
    "ssl_certificate", "ssl_certificate_key", "ssl_trusted_certificate",
    "ssl_client_certificate", "ssl_protocols", "ssl_ciphers",
    "ssl_prefer_server_ciphers", "ssl_dhparam", "ssl_session_cache",
    "ssl_session_timeout", "ssl_session_tickets", "ssl_session_ticket_key",
    "ssl_stapling", "ssl_stapling_verify", "ssl_verify_client",
    "ssl_verify_depth", "ssl_ecdh_curve", "ssl_buffer_size",
    "ssl_conf_command", "ssl_reject_handshake", "ssl_early_data",
    "ssl_password_file", "ssl_ocsp", "ssl_ocsp_cache", "ssl_crl",
    "http2", "resolver", "resolver_timeout"
}
PRESERVE = TLS_ONLY | {
    "access_log", "error_log", "auth_basic", "auth_basic_user_file",
    "allow", "deny"
}


def tls_include(name: str, ancestors: set[str]) -> list[Directive]:
    if not name.startswith("/") or any(c in name for c in "\r\n"):
        raise Unsafe("Cannot resolve non-absolute Nginx include: " + name)
    paths = sorted(glob.glob(name))
    if not paths or len(paths) > 32:
        raise Unsafe("Cannot resolve Nginx include: " + name)
    result = []
    for path in paths:
        real = os.path.realpath(path)
        if real in ancestors or not os.path.isfile(real):
            raise Unsafe("Recursive/invalid Nginx include: " + path)
        for d in parse(pathlib.Path(real).read_text(encoding="utf-8"), real):
            if d.name == "include" and d.children is None and len(d.args) == 1:
                result += tls_include(d.args[0], ancestors | {real})
            elif d.name in TLS_ONLY and d.children is None:
                result.append(d)
            else:
                raise Unsafe("Shared/non-TLS include requires manual review: " + path)
    return result


def render(domain: str, paths: list[str], template: str, webroot: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", domain):
        raise Unsafe("Invalid domain")
    if template.count("server {\n") != 1 or \
       template.count("    root __WEB_ROOT__;") != 1 or \
       "    server_name __DOMAIN__;" not in template:
        raise Unsafe("Unexpected website template")
    body = template.split("    root __WEB_ROOT__;", 1)[1]
    body = body.replace("__DOMAIN__", domain).replace("__WEB_ROOT__", webroot)
    output = ["# Rust Signal managed vhost",
              "# Original Nginx listen directives and certificate paths preserved."]
    servers = 0
    for source in paths:
        p = pathlib.Path(source)
        if not p.is_file():
            raise Unsafe("Nginx source file missing: " + source)
        entries = parse(p.read_text(encoding="utf-8"), source)
        if any(x.name != "server" or x.children is None for x in entries):
            raise Unsafe("Not a dedicated Nginx vhost file: " + source)
        for entry in entries:
            ds = entry.children or []
            if [x.args for x in ds if x.name == "server_name" and
                x.children is None] != [[domain]]:
                raise Unsafe("Vhost not exclusively for " + domain + ": " + source)
            listens = [x for x in ds if x.name == "listen" and x.children is None]
            if not listens:
                raise Unsafe("Implicit listening socket needs manual review: " + source)
            if any(any(a in x.args for a in ("default_server", "quic", "proxy_protocol"))
                   for x in listens):
                raise Unsafe("Special listening socket needs manual review: " + source)
            direct = [x for x in ds if x.children is None and x.name in PRESERVE]
            for x in ds:
                if x.name == "include":
                    if x.children is not None or len(x.args) != 1:
                        raise Unsafe("Unsupported Nginx include: " + source)
                    direct += tls_include(x.args[0], set())
            is_ssl = any("ssl" in x.args for x in listens)
            certs = [x for x in direct if x.name == "ssl_certificate"]
            keys = [x for x in direct if x.name == "ssl_certificate_key"]
            if is_ssl != bool(certs and keys) or len(certs) != len(keys):
                raise Unsafe("TLS listener/certificate mismatch: " + source)
            if not is_ssl and any(x.name.startswith("ssl_") for x in direct):
                raise Unsafe("TLS options without an SSL listener: " + source)
            output.append("server {")
            output += [nginx_line(x.name, x.args) for x in listens]
            output.append(nginx_line("server_name", [domain]))
            output += [nginx_line(x.name, x.args) for x in direct]
            # Keep pre-existing HSTS/CSP directives; cache/content policies come
            # from the current game website template instead of the old site.
            for x in ds:
                if x.name == "add_header" and x.children is None and x.args and \
                   x.args[0].lower() in ("strict-transport-security",
                                        "content-security-policy"):
                    output.append(nginx_line(x.name, x.args))
            output.append(nginx_line("root", [webroot]))
            output.append(body.lstrip("\n"))
            servers += 1
    if not servers:
        raise Unsafe("No suitable Nginx server block found")
    return "\n".join(output).rstrip() + "\n"


def main() -> None:
    if len(sys.argv) != 6:
        raise Unsafe("Usage: render-replacement.py DOMAIN FILES TEMPLATE WEBROOT OUTPUT")
    domain, manifest, template_path, webroot, output = sys.argv[1:]
    paths = pathlib.Path(manifest).read_text(encoding="utf-8").splitlines()
    if not paths or len(paths) > 8 or len(paths) != len(set(paths)):
        raise Unsafe("Invalid Nginx vhost file manifest")
    template = pathlib.Path(template_path).read_text(encoding="utf-8")
    generated = render(domain, paths, template, webroot)
    pathlib.Path(output).write_text(generated, encoding="utf-8")
    print(f"[Rust Signal replace] Preserved Nginx listeners from {len(paths)} file(s).")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, Unsafe) as exc:
        print("ERROR: Cannot safely render replacement: " + str(exc), file=sys.stderr)
        sys.exit(1)
