#!/usr/bin/env bash
# Local stack: stand-in Ginesys (:4100) + API cluster (:4000). Postgres and Redis must be running.
#   scripts/stack.sh          start both (keeps existing data)
#   scripts/stack.sh --fresh  reset schema, seed the full-scale dataset, then start
set -e
cd "$(dirname "$0")/.."
LOGS=${LOGS:-/tmp/citrus-logs}; mkdir -p "$LOGS"
export MOCK_STATE_FILE=${MOCK_STATE_FILE:-$LOGS/ginesys-state.json}
if [ "$1" = "--fresh" ]; then rm -f "$MOCK_STATE_FILE"; fi
(cd apps/mock-ginesys && setsid nohup node --import tsx src/server.ts > "$LOGS/ginesys.log" 2>&1 < /dev/null &)
for i in $(seq 1 30); do curl -sf localhost:4100/health >/dev/null && break; sleep 1; done
if [ "$1" = "--fresh" ]; then
  (cd apps/api && npx tsx src/db/migrate.ts --reset && npx tsx src/db/seed.ts)
fi
(cd apps/api && LOG_LEVEL=${LOG_LEVEL:-warn} setsid nohup node --import tsx src/cluster.ts > "$LOGS/api.log" 2>&1 < /dev/null &)
for i in $(seq 1 30); do curl -sf localhost:4000/ready >/dev/null && break; sleep 1; done
if [ "$1" = "--fresh" ]; then (cd apps/api && npx tsx src/db/seed-queue.ts); fi
echo "API :4000 and stand-in Ginesys :4100 are up. Logs in $LOGS. Now: npm run dev -w apps/web"
