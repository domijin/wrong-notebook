#!/usr/bin/env bash
# 等到接近本地午夜再 Apply Resource Manager stack（非高峰容量更好）。
# 用法:
#   ./cloud-shell-apply-until-capacity.sh
# 环境变量:
#   LOCAL_TZ=America/Los_Angeles   # 午夜按此时区算
#   TARGET_HOUR=0 TARGET_MINUTE=5  # 目标时刻（默认 00:05）
#   JITTER_SEC=600                 # 目标前后随机抖动（默认 ±10 分钟）
#   WINDOW_RETRIES=6               # 午夜窗口内连续尝试次数
#   WINDOW_INTERVAL_SEC=300        # 窗口内间隔（默认 5 分钟）
#   MAX_NIGHTS=14                  # 最多跨多少个午夜
# 只对 Out of capacity 重试；其它错误直接退出。

set -euo pipefail

STACK_ID="${STACK_ID:-ocid1.ormstack.oc1.us-sanjose-1.amaaaaaas7aq4diax3z2x64jn3tjgy66ci5yirqu2rurqezl4dx5udibsdaq}"
REGION="${REGION:-us-sanjose-1}"
LOCAL_TZ="${LOCAL_TZ:-America/Los_Angeles}"
TARGET_HOUR="${TARGET_HOUR:-0}"
TARGET_MINUTE="${TARGET_MINUTE:-5}"
JITTER_SEC="${JITTER_SEC:-600}"
WINDOW_RETRIES="${WINDOW_RETRIES:-6}"
WINDOW_INTERVAL_SEC="${WINDOW_INTERVAL_SEC:-300}"
MAX_NIGHTS="${MAX_NIGHTS:-14}"
DISPLAY_NAME_PREFIX="${DISPLAY_NAME_PREFIX:-wrong-notebook-a1-apply}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

need_oci() {
  if ! command -v oci >/dev/null 2>&1; then
    log "ERROR: oci CLI not found"
    exit 1
  fi
}

# 距下次「TARGET_HOUR:TARGET_MINUTE ± jitter」还有多少秒（按 LOCAL_TZ）
seconds_until_next_midnight_slot() {
  local now_epoch target_epoch now_hm jitter
  now_epoch="$(TZ="$LOCAL_TZ" date +%s)"
  jitter=$(( RANDOM % (JITTER_SEC * 2 + 1) - JITTER_SEC ))
  target_epoch="$(TZ="$LOCAL_TZ" date -j -f '%Y-%m-%d %H:%M:%S' \
    "$(TZ="$LOCAL_TZ" date +%Y-%m-%d) $(printf '%02d:%02d:00' "$TARGET_HOUR" "$TARGET_MINUTE")" \
    +%s 2>/dev/null || true)"

  # GNU date fallback (Cloud Shell / Linux)
  if [[ -z "${target_epoch:-}" ]]; then
    target_epoch="$(TZ="$LOCAL_TZ" date -d "today ${TARGET_HOUR}:${TARGET_MINUTE}:00" +%s)"
  fi

  target_epoch=$(( target_epoch + jitter ))
  if (( target_epoch <= now_epoch + 30 )); then
    # 已过今晚窗口起点 → 推到明天同一时刻
    if date -j >/dev/null 2>&1; then
      target_epoch="$(TZ="$LOCAL_TZ" date -j -v+1d -f '%Y-%m-%d %H:%M:%S' \
        "$(TZ="$LOCAL_TZ" date +%Y-%m-%d) $(printf '%02d:%02d:00' "$TARGET_HOUR" "$TARGET_MINUTE")" \
        +%s)"
    else
      target_epoch="$(TZ="$LOCAL_TZ" date -d "tomorrow ${TARGET_HOUR}:${TARGET_MINUTE}:00" +%s)"
    fi
    target_epoch=$(( target_epoch + jitter ))
  fi

  echo $(( target_epoch - now_epoch ))
  now_hm="$(TZ="$LOCAL_TZ" date '+%Y-%m-%d %H:%M:%S %Z')"
  log "local now=$now_hm; next slot in $(( target_epoch - now_epoch ))s (~$(TZ="$LOCAL_TZ" date -r "$target_epoch" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || TZ="$LOCAL_TZ" date -d "@$target_epoch" '+%Y-%m-%d %H:%M %Z'))" >&2
}

wait_job() {
  local job_id="$1"
  local state=""
  while true; do
    state="$(oci resource-manager job get --job-id "$job_id" --region "$REGION" \
      --query 'data."lifecycle-state"' --raw-output 2>/dev/null || true)"
    case "$state" in
      SUCCEEDED) echo "$state"; return 0 ;;
      FAILED|CANCELED) echo "$state"; return 1 ;;
      *) sleep 15 ;;
    esac
  done
}

job_error_text() {
  local job_id="$1"
  oci resource-manager job get --job-id "$job_id" --region "$REGION" \
    --query 'data."failure-details"' --raw-output 2>/dev/null || true
  oci resource-manager job get-job-logs --job-id "$job_id" --region "$REGION" \
    --query 'data[*].message' --raw-output 2>/dev/null | tail -n 40 || true
}

is_capacity_error() {
  local text="$1"
  grep -qiE 'out of (host )?capacity|InternalError.*capacity' <<<"$text"
}

run_one_apply() {
  local name job_json job_id state err_text
  name="${DISPLAY_NAME_PREFIX}-$(date -u +%Y%m%d-%H%M%S)"
  log "create APPLY job ($name)"

  job_json="$(oci resource-manager job create-apply-job \
    --stack-id "$STACK_ID" \
    --execution-plan-strategy AUTO_APPROVED \
    --display-name "$name" \
    --region "$REGION" \
    --wait-for-state SUCCEEDED \
    --wait-for-state FAILED \
    --wait-interval-seconds 15 \
    --max-wait-seconds 3600 \
    2>&1)" || true

  job_id="$(grep -oE 'ocid1.ormjob[.a-z0-9-]+' <<<"$job_json" | head -n1 || true)"

  if [[ -z "$job_id" ]]; then
    job_id="$(oci resource-manager job create-apply-job \
      --stack-id "$STACK_ID" \
      --execution-plan-strategy AUTO_APPROVED \
      --display-name "$name" \
      --region "$REGION" \
      --query 'data.id' --raw-output)"
    log "job=$job_id waiting..."
    if wait_job "$job_id"; then
      log "SUCCESS: apply job succeeded ($job_id)"
      return 0
    fi
  else
    state="$(oci resource-manager job get --job-id "$job_id" --region "$REGION" \
      --query 'data."lifecycle-state"' --raw-output)"
    if [[ "$state" == "SUCCEEDED" ]]; then
      log "SUCCESS: apply job succeeded ($job_id)"
      return 0
    fi
  fi

  err_text="$(job_error_text "$job_id")"
  log "job=$job_id failed; last logs:"
  printf '%s\n' "$err_text" | tail -n 20

  if is_capacity_error "$err_text $job_json"; then
    return 1
  fi

  log "ERROR: non-capacity failure — stop"
  exit 2
}

need_oci
log "stack=$STACK_ID region=$REGION tz=$LOCAL_TZ target=${TARGET_HOUR}:$(printf '%02d' "$TARGET_MINUTE") ±${JITTER_SEC}s window_retries=$WINDOW_RETRIES max_nights=$MAX_NIGHTS"

night=1
while (( night <= MAX_NIGHTS )); do
  wait_sec="$(seconds_until_next_midnight_slot)"
  # seconds_until 把诊断打到 stderr；stdout 只有数字
  wait_sec="$(printf '%s' "$wait_sec" | tail -n1)"
  log "night $night/$MAX_NIGHTS: sleeping ${wait_sec}s until near midnight ($LOCAL_TZ)"
  sleep "$wait_sec"

  attempt=1
  while (( attempt <= WINDOW_RETRIES )); do
    log "night $night window attempt $attempt/$WINDOW_RETRIES"
    if run_one_apply; then
      exit 0
    fi
    log "capacity miss in midnight window"
    if (( attempt < WINDOW_RETRIES )); then
      log "sleep ${WINDOW_INTERVAL_SEC}s then retry in-window"
      sleep "$WINDOW_INTERVAL_SEC"
    fi
    attempt=$((attempt + 1))
  done

  log "midnight window exhausted — wait for next night"
  night=$((night + 1))
done

log "gave up after $MAX_NIGHTS nights"
exit 3
