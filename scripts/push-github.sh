#!/usr/bin/env bash
set -euo pipefail

cd /home/runner/workspace

git config user.email "agent@replit.com" 2>/dev/null || true
git config user.name "Replit Agent" 2>/dev/null || true

git add -A

if git diff --cached --quiet; then
  echo "[push] Nothing to commit."
else
  git commit -m "fix: audit session 4 — 11 bugs fixed, BUGS.md added"
fi

git fetch focusflow main 2>&1 || true
git rebase focusflow/main 2>&1 || true
git push focusflow HEAD:main
echo "[push] Done."
