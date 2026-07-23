#!/usr/bin/env bash
set -euo pipefail

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
