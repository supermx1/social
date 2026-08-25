#!/bin/bash
#
# "Social OS.app"'s main executable. macOS runs this when the user opens the app, and quits the
# app when it exits — so this script starts everything, then blocks.
#
# Nothing here assumes a developer's machine: no PATH beyond what launchd provides, no repo
# checkout, no npm, no bun. Both binaries it runs are inside the bundle.
set -eu

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
DATA="$HOME/Library/Application Support/Social OS"
PORT=8095
URL="http://127.0.0.1:$PORT"
WORKER_SUPERUSER="worker@socialos.local"

die() {
	osascript -e "display alert \"Social OS\" message \"$1\" as critical" >/dev/null 2>&1 || true
	exit 1
}

# This bundle ships arm64 binaries only. Say so plainly instead of dying with a
# "Bad CPU type" the user can't act on — the source builds fine for Intel.
#
# `uname -m` is NOT the right check here: it reports the CURRENT PROCESS's architecture,
# which is x86_64 whenever anything upstream of this launch (e.g. the app that ran `open`)
# is itself running under Rosetta — even on real Apple Silicon hardware, and even though the
# arm64-only binaries below run natively just fine once actually exec'd. hw.optional.arm64
# asks about the HARDWARE instead, so it reports correctly regardless of translation state.
[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] || die "This build is for Apple Silicon Macs only. On an Intel Mac, build from source: see the README."

if /usr/bin/nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
	die "Port $PORT is already in use. Social may already be running — check the Dock."
fi

mkdir -p "$DATA/pb_data"

# MEDIA_DIR and PROFILES_DIR are stored as relative paths (./data/media), so they resolve
# against the working directory. In a packaged app that would otherwise be "/" — anchor it
# here and generated images land in Application Support instead of failing to write.
cd "$DATA"

# The worker signs in as its own superuser with a password nobody ever sees or types. It is
# deliberately NOT the account the human creates in the UI: no shared secret, and revoking
# one never locks out the other.
WORKER_ENV="$DATA/worker.env"
if [ ! -f "$WORKER_ENV" ]; then
	PASSWORD="$(/usr/bin/openssl rand -hex 24)"
	"$RESOURCES/backend" superuser upsert "$WORKER_SUPERUSER" "$PASSWORD" \
		--dir "$DATA/pb_data" --migrationsDir "$RESOURCES/pb_migrations" >/dev/null
	( umask 077; cat > "$WORKER_ENV" <<-EOF
		PB_URL=$URL
		PB_SUPERUSER_EMAIL=$WORKER_SUPERUSER
		PB_SUPERUSER_PASSWORD=$PASSWORD
	EOF
	)
fi

PB_PID=""
WORKER_PID=""
cleanup() {
	[ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
	[ -n "$PB_PID" ] && kill "$PB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --origins is the one that matters for safety: PocketBase allows all origins by default,
# which would let any website the user has open read the `env` collection — API keys included —
# straight off localhost. Restrict it to this app's own origin.
"$RESOURCES/backend" serve \
	--http="127.0.0.1:$PORT" \
	--dir "$DATA/pb_data" \
	--hooksDir "$RESOURCES/pb_hooks" \
	--migrationsDir "$RESOURCES/pb_migrations" \
	--publicDir "$RESOURCES/pb_public" \
	--origins "$URL,http://localhost:$PORT" \
	--hooksWatch=false \
	>> "$DATA/backend.log" 2>&1 &
PB_PID=$!

for _ in $(seq 1 30); do
	/usr/bin/curl -fsS -o /dev/null "$URL/api/health" && break
	sleep 0.5
done
/usr/bin/curl -fsS -o /dev/null "$URL/api/health" || die "The backend didn't start. See $DATA/backend.log"

set -a
# shellcheck disable=SC1090
. "$WORKER_ENV"
set +a
"$RESOURCES/worker" >> "$DATA/worker.log" 2>&1 &
WORKER_PID=$!

/usr/bin/open "$URL"

# Blocks until PocketBase exits, at which point the trap stops the worker and the app quits.
wait "$PB_PID"
