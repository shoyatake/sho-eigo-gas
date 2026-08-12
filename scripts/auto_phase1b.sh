#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - Phase 1-B 完全自動実行 (Cloud Shell 1 行)
# ═══════════════════════════════════════════════
#
# Chrome Claude も Cloud Shell 手順 7 ステップも経由せず、
# `gh workflow run` + `gh run watch` で 1 コマンド完結する。
#
# 前提:
#   - gh CLI が認証済 (Cloud Shell では gh auth login でセットアップ済の想定)
#   - secrets.FTP_PASS が登録済 (deploy.yml と共有)
#
# 使い方:
#   bash scripts/auto_phase1b.sh
#
#   # dry-run のみ:
#   DRY_RUN=1 bash scripts/auto_phase1b.sh
#
#   # auto-confirm を切って手動 OK で本番に進む:
#   AUTO_CONFIRM=0 bash scripts/auto_phase1b.sh
# ═══════════════════════════════════════════════

set -uo pipefail

REPO="shoyatake/sho-eigo-gas"
BRANCH="claude/v1.1-parent-trial-realign"
WORKFLOW="phase1b_l3_advanced.yml"
DRY_RUN="${DRY_RUN:-0}"
AUTO_CONFIRM="${AUTO_CONFIRM:-1}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }
err()  { echo -e "${RED}[x]${NC}  $*" >&2; }

if ! command -v gh >/dev/null 2>&1; then
  err "gh CLI が無い。Cloud Shell では本来 install 済。'gh auth status' で認証確認してください。"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  err "gh が未認証。'gh auth login' を実行して GitHub.com にログインしてください。"
  exit 1
fi

run_workflow() {
  local skip_upload="$1"
  echo ""
  echo "▶ workflow_dispatch (skip_upload=${skip_upload})"
  gh workflow run "$WORKFLOW" \
    --repo "$REPO" \
    --ref "$BRANCH" \
    -f skip_upload="$skip_upload" \
    -f skip_top_inject=false
  ok "起動完了。直近の run を待機"
  sleep 4
  # 直近の run ID を取得
  local run_id
  run_id=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 --json databaseId -q '.[0].databaseId')
  echo "  run_id = $run_id"
  echo "  URL:    https://github.com/${REPO}/actions/runs/${run_id}"
  # 完了まで watch
  gh run watch "$run_id" --repo "$REPO" --exit-status
  local rc=$?
  if [ $rc -ne 0 ]; then
    err "run ${run_id} 失敗 (exit=$rc)。ログを表示します:"
    gh run view "$run_id" --repo "$REPO" --log-failed | head -60
    return $rc
  fi
  echo "$run_id"
  return 0
}

verify_run_log() {
  local run_id="$1"
  local log
  log=$(gh run view "$run_id" --repo "$REPO" --log 2>/dev/null)
  local ok_marker err_marker
  ok_marker=$(echo "$log" | grep -c "✅ Phase 1-B 完了")
  err_marker=$(echo "$log" | grep -cE '\[x\]|\[err\]')
  echo "  ✅ markers: $ok_marker   [x]/[err]: $err_marker"
  [ "$ok_marker" -gt 0 ] && [ "$err_marker" -eq 0 ]
}

# ─── Phase 1: dry-run ───
echo "══════════════════════════════════════════════"
echo "  Phase 1-B 自動実行"
echo "  REPO=$REPO  BRANCH=$BRANCH"
echo "══════════════════════════════════════════════"

DRY_RUN_ID=$(run_workflow true | tail -1)
if [ -z "$DRY_RUN_ID" ] || ! [[ "$DRY_RUN_ID" =~ ^[0-9]+$ ]]; then
  err "dry-run の run_id が取れない"
  exit 1
fi
ok "dry-run 完了 run_id=$DRY_RUN_ID"

if ! verify_run_log "$DRY_RUN_ID"; then
  err "dry-run の検証に失敗。本番に進まない。"
  echo "  ログ確認: gh run view $DRY_RUN_ID --repo $REPO --log"
  exit 1
fi
ok "dry-run 検証 PASS"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "DRY_RUN=1 のためここで停止。本番に進むには DRY_RUN=0 (既定) で再実行。"
  exit 0
fi

# ─── Phase 2: 本番 ───
if [ "$AUTO_CONFIRM" != "1" ]; then
  echo ""
  read -r -p "本番実行 (skip_upload=false) に進みますか? (yes/no): " ans
  [ "$ans" = "yes" ] || { echo "中止"; exit 1; }
fi

LIVE_ID=$(run_workflow false | tail -1)
if [ -z "$LIVE_ID" ] || ! [[ "$LIVE_ID" =~ ^[0-9]+$ ]]; then
  err "本番 run の run_id が取れない"
  exit 1
fi
ok "本番完了 run_id=$LIVE_ID"

if ! verify_run_log "$LIVE_ID"; then
  err "本番ログ検証に失敗。手動でログ確認 + ロールバック検討:"
  echo "  gh run view $LIVE_ID --repo $REPO --log"
  echo "  rollback: Artifacts から *_intermediate.html をダウンロードして FTP に再アップ"
  exit 1
fi

# ─── 完了報告 ───
cat <<EOF

══════════════════════════════════════════════
  ✅ Phase 1-B 完全自動完了
══════════════════════════════════════════════

  dry-run Run: https://github.com/${REPO}/actions/runs/${DRY_RUN_ID}
  本番 Run:    https://github.com/${REPO}/actions/runs/${LIVE_ID}

  公開ページ:
    https://sho-blog.com/courses/parent/advanced/
    https://sho-blog.com/courses/student/advanced/

  バックアップ Artifacts:
    https://github.com/${REPO}/actions/runs/${DRY_RUN_ID}

══════════════════════════════════════════════

EOF
