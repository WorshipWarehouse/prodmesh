#!/usr/bin/env bash
#
# Does this password open this certificate, and is the certificate the right
# kind? Run this BEFORE setting the GitHub secrets — it is the same check the
# desktop workflow's preflight makes, so a pass here means a pass there.
#
#   ./desktop/check-signing-cert.sh ~/Desktop/prodmesh-cert.p12
#   ./desktop/check-signing-cert.sh ~/Desktop/prodmesh-cert.p12.b64 ~/Desktop/pw.txt
#
# With no password file it prompts, so the password never reaches your shell
# history. Accepts the .b64 as well as the .p12 so you can test the exact bytes
# you are about to paste into a secret, rather than something adjacent to them.
#
# Why this exists: electron-builder's failure for a wrong password is a PKCS12
# stack trace ending "MAC verification failed during PKCS12 import (wrong
# password?)". It names neither secret and reads like a corrupt certificate,
# when the certificate is usually fine.
set -euo pipefail

CERT="${1:-}"
PW_FILE="${2:-}"

if [ -z "$CERT" ] || [ ! -f "$CERT" ]; then
  echo "usage: $0 <cert.p12 | cert.p12.b64> [password-file]" >&2
  exit 2
fi

TMP="$(mktemp -d)"
KC="$TMP/check.keychain"
P12="$TMP/cert.p12"
cleanup() {
  security delete-keychain "$KC" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# base64 or raw? A PKCS#12 file starts with the DER SEQUENCE tag 0x30.
if [ "$(head -c 1 "$CERT" | xxd -p)" = "30" ]; then
  echo "→ input looks like a raw .p12"
  cp "$CERT" "$P12"
else
  echo "→ input looks like base64; decoding"
  if ! base64 --decode < "$CERT" > "$P12" 2>/dev/null || [ ! -s "$P12" ]; then
    echo "✗ not valid base64 — regenerate with: base64 -i cert.p12 -o cert.p12.b64" >&2
    exit 1
  fi
  if [ "$(head -c 1 "$P12" | xxd -p)" != "30" ]; then
    echo "✗ decoded, but the result is not a PKCS#12 file" >&2
    exit 1
  fi
fi

if [ -n "$PW_FILE" ]; then
  [ -f "$PW_FILE" ] || { echo "✗ no such password file: $PW_FILE" >&2; exit 2; }
  # Read the file's EXACT bytes, trailing newline included. `$(cat file)` would
  # strip it — and `gh secret set < file` does not, so stripping here would
  # pass a file that then fails in CI. That is the likeliest way a password
  # secret goes wrong, so this check has to be able to see it.
  PW="$(cat "$PW_FILE"; printf x)"
  PW="${PW%x}"
  case "$PW" in
    *[[:space:]]) echo "⚠ the password file ends in whitespace (newline?)."
                  echo "  \`gh secret set < file\` sends that verbatim and CI will reject it."
                  echo "  Strip it with:  printf '%s' \"\$(cat $PW_FILE)\" > $PW_FILE" ;;
  esac
else
  # -s so it is not echoed; this is the same value that becomes a secret.
  read -r -s -p "Certificate password: " PW
  echo
fi

security create-keychain -p "" "$KC"
security unlock-keychain -p "" "$KC"

if ! security import "$P12" -k "$KC" -P "$PW" -T /usr/bin/codesign >/dev/null 2>&1; then
  echo "✗ the password does NOT open this certificate."
  echo "  The .p12 itself is readable, so it is the password that is wrong."
  echo "  If you are checking a secret you already set, re-set it with:"
  echo "    gh secret set MACOS_CERT_P12_PASSWORD < <password file>"
  echo "  (redirection, not a paste — that is where stray newlines come from)"
  exit 1
fi
echo "✓ the password opens the certificate"

IDENTITIES="$(security find-identity -v -p codesigning "$KC" | grep "Developer ID Application" || true)"
if [ -z "$IDENTITIES" ]; then
  echo "✗ it opened, but carries no \"Developer ID Application\" identity WITH a private key."
  echo "  That is the half-export failure: Keychain Access exports only the"
  echo "  certificate unless you select the identity. Re-export with:"
  echo "    security export -t identities -f pkcs12 -o cert.p12"
  exit 1
fi

echo "✓ carries a Developer ID Application identity with its private key:"
echo "$IDENTITIES" | sed 's/^/    /'
echo
echo "This certificate and password will work in CI."
