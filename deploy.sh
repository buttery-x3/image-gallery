#!/usr/bin/env bash

set -Eeuo pipefail

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_owner="$(stat -c '%U' "$repository_dir")"
pm2_app_name="${PM2_APP_NAME:-}"

if [[ -z "$pm2_app_name" && -f "$repository_dir/.env" ]]; then
  pm2_app_name="$(sed -n 's/^PM2_APP_NAME=//p' "$repository_dir/.env" | tail -n 1)"
  pm2_app_name="${pm2_app_name%$'\r'}"
  pm2_app_name="${pm2_app_name#\"}"
  pm2_app_name="${pm2_app_name%\"}"
  pm2_app_name="${pm2_app_name#\'}"
  pm2_app_name="${pm2_app_name%\'}"
fi

if [[ -z "$pm2_app_name" ]]; then
  printf 'Set PM2_APP_NAME in %s/.env before deploying.\n' "$repository_dir" >&2
  exit 1
fi

if [[ ! "$pm2_app_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'PM2_APP_NAME contains unsupported characters.\n' >&2
  exit 1
fi

run_in_repository() {
  if [[ "$EUID" -eq 0 && "$repository_owner" != "root" ]]; then
    sudo -H -u "$repository_owner" -- "$@"
  else
    "$@"
  fi
}

run_in_repository git -C "$repository_dir" pull --ff-only
run_in_repository npm --prefix "$repository_dir" ci
run_in_repository npm --prefix "$repository_dir" run typecheck
run_in_repository npm --prefix "$repository_dir" run build
run_in_repository pm2 restart "$pm2_app_name"

printf 'Deployed and restarted PM2 app %s.\n' "$pm2_app_name"
