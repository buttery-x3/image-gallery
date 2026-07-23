#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$repo_dir"

if ! node --input-type=module -e 'await import("argon2")' >/dev/null 2>&1; then
  echo "argon2 is not installed in $repo_dir." >&2
  echo "Run: npm install argon2@^0.44.0 --save" >&2
  exit 1
fi

read -r -s -p "Admin password: " admin_password
printf '\n'
read -r -s -p "Confirm password: " admin_password_confirm
printf '\n'

if [[ -z "$admin_password" ]]; then
  echo "Password cannot be empty." >&2
  exit 1
fi

if [[ "$admin_password" != "$admin_password_confirm" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi

admin_hash=$(
  GALLERY_ADMIN_PASSWORD="$admin_password" node --input-type=module -e \
    'import argon2 from "argon2"; console.log(await argon2.hash(process.env.GALLERY_ADMIN_PASSWORD, { type: argon2.argon2id }))'
)

unset admin_password admin_password_confirm
printf "\nAdd this line to .env:\n\nADMIN_PASSWORD_HASH='%s'\n" "$admin_hash"
