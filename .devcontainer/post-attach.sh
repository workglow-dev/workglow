#!/usr/bin/env bash
#
# @copyright
# Copyright 2026 Steven Roussey
# All Rights Reserved

set +e

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$_here/use-host-gpg.sh"

if [ -z "$(git config --global user.name 2>/dev/null)" ]; then
  read -r -p "Enter your git name: " git_name || true
  if [ -n "${git_name:-}" ]; then
    git config --global user.name "$git_name" || true
  fi
fi
if [ -z "$(git config --global user.email 2>/dev/null)" ]; then
  read -r -p "Enter your git email: " git_email || true
  if [ -n "${git_email:-}" ]; then
    git config --global user.email "$git_email" || true
  fi
fi

exit 0
