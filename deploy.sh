#!/usr/bin/env bash

set -Eeuo pipefail

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_owner="$(stat -c '%U' "$repository_dir")"
service_name="${SERVICE_NAME:-image-gallery}"

run_in_repository() {
  if [[ "$EUID" -eq 0 && "$repository_owner" != "root" ]]; then
    sudo -H -u "$repository_owner" -- "$@"
  else
    "$@"
  fi
}

restart_service() {
  if [[ "$EUID" -eq 0 ]]; then
    systemctl restart "$service_name"
    systemctl is-active --quiet "$service_name"
  else
    sudo systemctl restart "$service_name"
    sudo systemctl is-active --quiet "$service_name"
  fi
}

run_in_repository git -C "$repository_dir" pull --ff-only
run_in_repository npm --prefix "$repository_dir" ci
run_in_repository npm --prefix "$repository_dir" run typecheck
run_in_repository npm --prefix "$repository_dir" run build
restart_service

printf 'Deployed and restarted %s.\n' "$service_name"
