#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# push_to_github.sh
# Commit any pending changes and push to focusflow-native on GitHub.
#
# Usage:
#   bash push_to_github.sh [optional commit message]
#
# Requires:
#   GITHUB_PERSONAL_ACCESS_TOKEN  — set as a Replit Secret
# ──────────────────────────────────────────────────────────────────────────────
set -e

TARGET_REPO="TITANICBHAI/focusflow-native"
BRANCH="main"

if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  echo "ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set."
  echo "Add it as a Replit Secret and re-run this script."
  exit 1
fi

REMOTE_URL="https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${TARGET_REPO}.git"

export GIT_AUTHOR_NAME="FocusFlow Bot"
export GIT_AUTHOR_EMAIL="focusflow-bot@tbtechs.app"
export GIT_COMMITTER_NAME="FocusFlow Bot"
export GIT_COMMITTER_EMAIL="focusflow-bot@tbtechs.app"

# Remove any stale lock files
rm -f .git/index.lock .git/MERGE_HEAD .git/CHERRY_PICK_HEAD 2>/dev/null || true

# Stage and commit if there are pending changes
if ! git diff --quiet || ! git diff --staged --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Staging pending changes..."
  git add -A

  CHANGED_FILES=$(git diff --cached --name-only | head -10 | tr '\n' ', ' | sed 's/,$//')
  FILE_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')

  if [ -n "$1" ]; then
    COMMIT_MSG="$1"
  elif [ "$FILE_COUNT" -le 3 ]; then
    COMMIT_MSG="Update ${CHANGED_FILES} [${TIMESTAMP}]"
  else
    COMMIT_MSG="Update ${FILE_COUNT} files — ${TIMESTAMP}"
  fi

  git commit -m "$COMMIT_MSG"
  echo "Committed: $COMMIT_MSG"
else
  echo "Nothing to commit — working tree clean."
fi

# Ensure the remote exists and points to focusflow-native
if git remote | grep -q "^native$"; then
  git remote set-url native "$REMOTE_URL"
else
  git remote add native "$REMOTE_URL"
fi

echo "Pushing HEAD → github.com/${TARGET_REPO} (${BRANCH})..."
git push native HEAD:"$BRANCH" --force
echo "Done. View at: https://github.com/${TARGET_REPO}"
