#!/usr/bin/env bash
# Candidate diagnostic only: never starts Discord or deploys production code.
set -u
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1
mkdir -p tmp || exit 1
LOG_DIR="$(mktemp -d "$PWD/tmp/chat-console-live-$(date +%Y%m%d-%H%M%S)-XXXXXX")" || exit 1
export LOG_DIR
if [ "$#" -eq 0 ]; then
  set -- toefl-search toefl-fact news weather mixed product-comparison wiki self-answer
fi
{
  printf 'candidate_path=%s\n' "$PWD"
  printf 'started_at=%s\n' "$(date -Iseconds)"
  printf 'dotenv_path=%s\n' "${DOTENV_CONFIG_PATH:-/home/ubuntu/discord-bot-new/.env}"
  git rev-parse HEAD
  git status --short
} > "$LOG_DIR/identity.txt"
printf 'case\tstarted_at\tfinished_at\texit_code\n' > "$LOG_DIR/runs.tsv"
for CASE in "$@"; do
  case "$CASE" in
    mixed|toefl-fact|toefl-search|self-answer|news|wiki|product-comparison|weather) ;;
    *) printf 'Unknown case: %s\n' "$CASE" >&2; exit 2 ;;
  esac
  STARTED="$(date -Iseconds)"
  printf '실행: %s\n' "$CASE"
  DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-/home/ubuntu/discord-bot-new/.env}" \
    node scripts/verify-chat-live.js --case "$CASE" \
    > "$LOG_DIR/$CASE.json" 2> "$LOG_DIR/$CASE.stderr.log"
  RESULT=$?
  printf '%s\t%s\t%s\t%s\n' "$CASE" "$STARTED" "$(date -Iseconds)" "$RESULT" >> "$LOG_DIR/runs.tsv"
  printf '완료: %s, exit=%s\n' "$CASE" "$RESULT"
done
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.LOG_DIR;
const rows = fs.readFileSync(path.join(dir,'runs.tsv'),'utf8').trim().split('\n').slice(1);
const combined = rows.map(row => {
  const [id,startedAt,finishedAt,exitCode] = row.split('\t');
  const rawStdout = fs.readFileSync(path.join(dir,`${id}.json`),'utf8');
  const stderr = fs.readFileSync(path.join(dir,`${id}.stderr.log`),'utf8');
  const run = {case:id,startedAt,finishedAt,exitCode:Number(exitCode),stderr};
  try { run.result = JSON.parse(rawStdout); }
  catch(error) { run.parseError = error.message; run.rawStdout = rawStdout; }
  return run;
});
const review = combined.map(({result:r,...run}) => ({...run,
  worktreeIdentity:r?.worktreeIdentity,question:r?.question,status:r?.status,now:r?.now,
  final:r?.final,timings:r?.timings,verification:r?.verification,failures:r?.failures,error:r?.error,
  retrieval:r?.trace?.filter(e=>['tryBuildWebSearchData','tryBuildPyhokWikiSearchData'].includes(e.event)),
  generatedAnswers:r?.trace?.filter(e=>e.event==='model-response'&&e.stage==='answer'),
  checksAndErrors:r?.trace?.filter(e=>/error|fail|verification|validation/.test(e.event)),
}));
for(const [name,data] of [['combined',combined],['review',review]])
  fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(data,null,2)+'\n');
fs.appendFileSync(path.join(dir,'identity.txt'),'\n'+JSON.stringify(combined.map(r=>({case:r.case,...r.result?.worktreeIdentity})),null,2)+'\n');
NODE
printf '\n로그 저장 경로: %s\n' "$LOG_DIR"
