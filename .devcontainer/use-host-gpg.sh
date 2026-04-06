#!/usr/bin/env bash
#
# When Cursor/VS Code forwards the host gpg-agent (socket at ~/.gnupg/S.gpg-agent),
# private keys should stay on the host only. This removes secret key material that may
# have been copied into the container so gpg/git use the forwarded agent.
#
# Host: use a GUI pinentry (e.g. macOS pinentry-mac in ~/.gnupg/gpg-agent.conf) so
# passphrase prompts appear on the host when you sign from the container.
#
# @copyright
# Copyright 2026 Steven Roussey
# All Rights Reserved

set -u

if ! command -v gpg-connect-agent >/dev/null 2>&1; then
  exit 0
fi

agent_msg="$(gpg-connect-agent UPDATESTARTUPTTY /bye 2>&1)" || true
case "$agent_msg" in
*restricted*) ;;
*) exit 0 ;;
esac

gnupg_home="${GNUPGHOME:-$HOME/.gnupg}"
if [[ ! -d "$gnupg_home" ]]; then
  exit 0
fi

echo "devcontainer: Using host GPG agent (forwarded). Removing container secret key dirs under $gnupg_home."

for name in private-keys-v1.d openpgp-revocs.d; do
  path="$gnupg_home/$name"
  if [[ -d "$path" ]]; then
    rm -rf "$path"
    echo "devcontainer: removed $path"
  fi
done

exit 0
