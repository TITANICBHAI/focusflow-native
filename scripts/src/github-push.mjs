#!/usr/bin/env node
/**
 * Push /tmp/FocusFlow → TITANICBHAI/focusflow-native via git.
 *
 * The script:
 *  1. Stages all changes in /tmp/FocusFlow
 *  2. Commits them (if anything is staged)
 *  3. Ensures the remote "native" points to focusflow-native
 *  4. Force-pushes main → focusflow-native
 *
 * Requires: GITHUB_PERSONAL_ACCESS_TOKEN env var
 */

import { execSync } from 'child_process';
import path from 'path';

const REPO_DIR = '/home/runner/workspace/FocusFlow';
const TARGET_REPO = 'TITANICBHAI/focusflow-native';
const BRANCH = 'main';

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!token) {
  console.error('ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const remoteUrl = `https://x-access-token:${token}@github.com/${TARGET_REPO}.git`;

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_DIR, stdio: 'pipe', ...opts })
    .toString()
    .trim();
}

function runPrint(cmd) {
  execSync(cmd, { cwd: REPO_DIR, stdio: 'inherit' });
}

console.log(`\n=== FocusFlow → focusflow-native push ===\n`);
console.log(`Source : ${REPO_DIR}`);
console.log(`Target : https://github.com/${TARGET_REPO}`);
console.log(`Branch : ${BRANCH}\n`);

// Ensure git identity is configured (required for commits)
run('git config user.email "focusflow-bot@replit.dev"');
run('git config user.name "FocusFlow Bot"');

// Stage all changes
runPrint('git add -A');

// Commit only if there is something to commit
const status = run('git status --porcelain');
if (status.length > 0) {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  runPrint(`git commit -m "chore: sync changes [${date}]"`);
  console.log('Committed staged changes.\n');
} else {
  console.log('Nothing new to commit — pushing existing HEAD.\n');
}

// Ensure the "native" remote exists and points to the right URL
let remotes = [];
try {
  remotes = run('git remote').split('\n').map((r) => r.trim());
} catch {}

if (remotes.includes('native')) {
  run(`git remote set-url native ${remoteUrl}`);
} else {
  run(`git remote add native ${remoteUrl}`);
}

// Push
console.log(`Pushing to ${TARGET_REPO} …`);
runPrint(`git push native HEAD:${BRANCH} --force`);
console.log('\nDone. Code is live on focusflow-native.\n');
