#!/bin/sh
# Chaos drill — ALWAYS against a scratch db, never var/charter.db.
# Proves: kill -9 mid-append corrupts nothing; restore-from-backup works
# on a clean directory; both timed.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)/drill"
mkdir -p "$SCRATCH/company" "$SCRATCH/var"
printf '{ "id": "co_drill", "name": "Drill Co" }\n' > "$SCRATCH/company/company.json"

echo "== drill 1: kill -9 mid-append =="
node --input-type=module -e "
import { openDb, migrate, ensureProjections, EventLog } from '$REPO/packages/core/dist/index.js';
const db = openDb('$SCRATCH/var/charter.db'); migrate(db); ensureProjections(db);
const log = new EventLog(db);
for (let i = 0; ; i++) log.append({ company_id: 'co_drill', stream: 'channel:devlog',
  type: 'devlog.note', actor: { kind: 'system', id: 'chaos' }, payload: { note: 'n' + i } });
" & PID=$!
sleep 0.5
kill -9 "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
node --input-type=module -e "
import { openDb, verify } from '$REPO/packages/core/dist/index.js';
const db = openDb('$SCRATCH/var/charter.db');
const r = verify(db);
if (!r.ok) { console.error('CHAIN BROKEN', r); process.exit(1); }
const ic = db.pragma('integrity_check');
console.log('  chain ok:', r.checked, 'events; integrity:', ic[0].integrity_check);
"

echo "== drill 2: timed restore onto a clean directory =="
START=$(date +%s)
BACKUP="$SCRATCH/backup.db"
sqlite3 "$SCRATCH/var/charter.db" "VACUUM INTO '$BACKUP'"
RESTORE="$(mktemp -d)/restored"
mkdir -p "$RESTORE/company" "$RESTORE/var"
printf '{ "id": "co_drill", "name": "Drill Co" }\n' > "$RESTORE/company/company.json"
cp "$BACKUP" "$RESTORE/var/charter.db"
node --input-type=module -e "
import { openDb, migrate, ensureProjections, verify, rebuild } from '$REPO/packages/core/dist/index.js';
const db = openDb('$RESTORE/var/charter.db'); migrate(db); ensureProjections(db);
rebuild(db);
const r = verify(db);
if (!r.ok) { console.error('RESTORE BROKEN', r); process.exit(1); }
console.log('  restored + rebuilt + verified:', r.checked, 'events');
"
END=$(date +%s)
echo "  restore drill: $((END - START))s (budget: 1800s)"
echo "== drills passed =="
