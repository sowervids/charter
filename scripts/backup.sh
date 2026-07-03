#!/bin/sh
# Nightly backup (risk #7, all $0):
#   1. SQLite snapshot via VACUUM INTO (consistent, compact)
#   2. Append-only JSONL export of the event log, gzipped
#   3. Optional: push to a private backups repo (set CHARTER_BACKUP_REMOTE)
# Schedule: crontab -e →  15 3 * * * sh /path/to/charter/scripts/backup.sh
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$REPO/var/backups"
mkdir -p "$DEST"

sqlite3 "$REPO/var/charter.db" "VACUUM INTO '$DEST/charter-$STAMP.db'"
sqlite3 -json "$REPO/var/charter.db" \
  "SELECT * FROM events ORDER BY seq" | gzip > "$DEST/events-$STAMP.jsonl.gz"

# Keep the last 14 local snapshots.
ls -t "$DEST"/charter-*.db 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null || true
ls -t "$DEST"/events-*.jsonl.gz 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null || true

if [ -n "${CHARTER_BACKUP_REMOTE:-}" ]; then
  BK="$HOME/.charter-backups"
  if [ ! -d "$BK/.git" ]; then
    git clone -q "$CHARTER_BACKUP_REMOTE" "$BK"
  fi
  cp "$DEST/events-$STAMP.jsonl.gz" "$BK/"
  cd "$BK" && git add -A && git commit -qm "backup $STAMP" && git push -q
fi
echo "backup ok: $DEST/charter-$STAMP.db"
