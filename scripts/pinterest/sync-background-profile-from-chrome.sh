#!/bin/zsh
set -euo pipefail

SOURCE_ROOT="${HOME}/Library/Application Support/Google/Chrome"
SOURCE_PROFILE="${PINTEREST_SOURCE_CHROME_PROFILE:-Profile 1}"
TARGET_ROOT="${HOME}/.openclaw/pinterest-background-chrome"

mkdir -p "$TARGET_ROOT"
mkdir -p "$TARGET_ROOT/$SOURCE_PROFILE"

rsync -a --delete \
  --exclude='Singleton*' \
  --exclude='LOCK' \
  --exclude='lockfile' \
  --exclude='*.tmp' \
  "$SOURCE_ROOT/Local State" \
  "$TARGET_ROOT/"

rsync -a --delete \
  --exclude='Singleton*' \
  --exclude='LOCK' \
  --exclude='lockfile' \
  --exclude='Cache/' \
  --exclude='Code Cache/' \
  --exclude='GPUCache/' \
  --exclude='Service Worker/CacheStorage/' \
  --exclude='Service Worker/ScriptCache/' \
  "$SOURCE_ROOT/$SOURCE_PROFILE/" \
  "$TARGET_ROOT/$SOURCE_PROFILE/"

echo "Synced Chrome profile"
echo "Source: $SOURCE_ROOT/$SOURCE_PROFILE"
echo "Target: $TARGET_ROOT/$SOURCE_PROFILE"
