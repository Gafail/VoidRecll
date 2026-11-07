#!/usr/bin/env bash
#
# Deploy VoidRecll to the LXC host.
#
#   ./deploy/deploy-lxc.sh
#
# The target is the dedicated container described in
# ~/Desktop/Local-LXC-Host.md: hostname VoidRecll, 192.168.100.198, app slot
# `voidrecll` on port 8080 behind nginx.
#
# This builds the site, ships it, and hands it to appctl, which rsyncs it into
# the app slot and restarts the service.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_IP="192.168.100.198"
APP_NAME="voidrecll"
KEY="${VOIDRECLL_SSH_KEY:-$HOME/Desktop/TheVoidCo/ops/keys/thevoidco-lxc-id_ed25519}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "root@$HOST_IP")

if [ ! -f "$KEY" ]; then
  echo "deploy: ssh key not found at $KEY" >&2
  echo "        set VOIDRECLL_SSH_KEY to point at it" >&2
  exit 1
fi

echo "==> building the site"
cd "$ROOT"
npm run build

echo "==> shipping to $HOST_IP"
STAGE="/root/staging/$APP_NAME"
"${SSH[@]}" "mkdir -p '$STAGE'"
tar -C "$ROOT/dist" -czf - . | "${SSH[@]}" "tar -xzf - -C '$STAGE'"

echo "==> handing over to appctl"
"${SSH[@]}" "appctl deploy $APP_NAME $STAGE"

echo "==> checking"
"${SSH[@]}" "systemctl is-active webapp@$APP_NAME.service"
"${SSH[@]}" "curl -sS -o /dev/null -w 'app replied: %{http_code}\n' -H 'Host: $HOST_IP' http://127.0.0.1/"

echo
echo "Done. The site is at http://$HOST_IP/"
