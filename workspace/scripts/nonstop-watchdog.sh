#!/bin/bash
#
# Anti-idle watchdog for Clawdbot/Moltbot agent (macOS)
# Detects when the bot has been idle despite having tasks in bot_current.
# Sends Telegram alert when idle detected.
#
# Usage: ./nonstop-watchdog.sh [--max-idle-minutes 10] [--quiet]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
TASKS_PATH="$WORKSPACE_DIR/memory/tasks.json"
HEALTH_STATE_PATH="$WORKSPACE_DIR/memory/last-healthy-state.json"
WATCHDOG_STATE_PATH="$WORKSPACE_DIR/memory/watchdog-state.json"

MAX_IDLE_MINUTES=10
QUIET=false
TELEGRAM_ALERT=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-idle-minutes)
      MAX_IDLE_MINUTES="$2"
      shift 2
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    --no-telegram)
      TELEGRAM_ALERT=false
      shift
      ;;
    *)
      shift
      ;;
  esac
done

log() {
  if [ "$QUIET" = false ]; then
    echo "[$(date '+%H:%M:%S')] [$1] $2"
  fi
}

# Get tasks in bot_current
get_bot_current_tasks() {
  if [ ! -f "$TASKS_PATH" ]; then
    echo ""
    return
  fi
  jq -r '.lanes.bot_current // [] | .[]' "$TASKS_PATH" 2>/dev/null || echo ""
}

# Get last activity time (returns epoch seconds)
get_last_activity_time() {
  local times=()

  # 1. Check last-healthy-state.json
  if [ -f "$HEALTH_STATE_PATH" ]; then
    local health_time=$(jq -r '.lastSeen // empty' "$HEALTH_STATE_PATH" 2>/dev/null)
    if [ -n "$health_time" ]; then
      local epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${health_time%%.*}" "+%s" 2>/dev/null || echo "")
      [ -n "$epoch" ] && times+=("$epoch")
    fi
  fi

  # 2. Check tasks.json updated_at
  if [ -f "$TASKS_PATH" ]; then
    local tasks_time=$(jq -r '.updated_at // empty' "$TASKS_PATH" 2>/dev/null)
    if [ -n "$tasks_time" ]; then
      local epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${tasks_time%%.*}" "+%s" 2>/dev/null || echo "")
      [ -n "$epoch" ] && times+=("$epoch")
    fi
  fi

  # 3. Check recent memory files
  if [ -d "$WORKSPACE_DIR/memory" ]; then
    local recent_file=$(ls -t "$WORKSPACE_DIR/memory"/*.json 2>/dev/null | head -1)
    if [ -n "$recent_file" ]; then
      local file_time=$(stat -f "%m" "$recent_file" 2>/dev/null || echo "")
      [ -n "$file_time" ] && times+=("$file_time")
    fi
  fi

  # Return most recent time
  if [ ${#times[@]} -eq 0 ]; then
    echo ""
    return
  fi

  printf '%s\n' "${times[@]}" | sort -rn | head -1
}

# Send Telegram alert
send_telegram_alert() {
  local message="$1"
  if [ "$TELEGRAM_ALERT" = false ]; then
    return
  fi

  # Try using moltbot CLI
  if command -v moltbot &> /dev/null; then
    moltbot send telegram "$message" 2>/dev/null && log "WARN" "Telegram alert sent" || log "ERROR" "Failed to send Telegram alert"
  else
    log "WARN" "moltbot CLI not found, skipping Telegram alert"
  fi
}

# Save watchdog state
save_watchdog_state() {
  local idle_detected="$1"
  local task_count="$2"

  cat > "$WATCHDOG_STATE_PATH" << EOF
{
  "checkedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "idleDetected": $idle_detected,
  "taskCount": $task_count,
  "maxIdleMinutes": $MAX_IDLE_MINUTES
}
EOF
}

# Main execution
NOW=$(date +%s)
TASKS=$(get_bot_current_tasks)
TASK_COUNT=$(echo "$TASKS" | grep -c . || echo "0")

log "INFO" "Watchdog check: $TASK_COUNT tasks in bot_current"

if [ "$TASK_COUNT" -eq 0 ] || [ -z "$TASKS" ]; then
  log "INFO" "No tasks in bot_current - all clear"
  save_watchdog_state "false" "0"
  echo '{"status":"ok","message":"No tasks pending","taskCount":0}'
  exit 0
fi

# Tasks exist - check for idle
LAST_ACTIVITY=$(get_last_activity_time)

if [ -z "$LAST_ACTIVITY" ]; then
  log "WARN" "Could not determine last activity time"
  save_watchdog_state "false" "$TASK_COUNT"
  echo "{\"status\":\"unknown\",\"message\":\"Could not determine last activity\",\"taskCount\":$TASK_COUNT}"
  exit 0
fi

IDLE_SECONDS=$((NOW - LAST_ACTIVITY))
IDLE_MINUTES=$((IDLE_SECONDS / 60))

log "INFO" "Last activity: $IDLE_MINUTES min ago"

if [ "$IDLE_MINUTES" -gt "$MAX_IDLE_MINUTES" ]; then
  log "WARN" "IDLE DETECTED: $IDLE_MINUTES minutes with $TASK_COUNT tasks pending"

  # Get first task info
  FIRST_TASK_ID=$(echo "$TASKS" | head -1)
  FIRST_TASK_TITLE=$(jq -r ".tasks.\"$FIRST_TASK_ID\".title // \"Unknown task\"" "$TASKS_PATH" 2>/dev/null)

  # Send alert
  ALERT_MSG="🚨 IDLE ALERT

Bot has been idle for $IDLE_MINUTES minutes with $TASK_COUNT tasks pending.

Next task: [$FIRST_TASK_ID] $FIRST_TASK_TITLE

Action required: Resume execution or investigate blocker."

  send_telegram_alert "$ALERT_MSG"
  save_watchdog_state "true" "$TASK_COUNT"

  echo "{\"status\":\"idle\",\"message\":\"Idle for $IDLE_MINUTES minutes with $TASK_COUNT tasks\",\"taskCount\":$TASK_COUNT,\"idleMinutes\":$IDLE_MINUTES,\"nextTask\":\"$FIRST_TASK_ID\",\"alertSent\":$TELEGRAM_ALERT}"
  exit 0
fi

# Active enough
log "INFO" "Activity within threshold ($IDLE_MINUTES < $MAX_IDLE_MINUTES min)"
save_watchdog_state "false" "$TASK_COUNT"

echo "{\"status\":\"active\",\"message\":\"Active with $TASK_COUNT tasks\",\"taskCount\":$TASK_COUNT,\"idleMinutes\":$IDLE_MINUTES}"
