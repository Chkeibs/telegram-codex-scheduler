#!/usr/bin/env bash
set -euo pipefail

mode="success"
for argument in "$@"; do
  [[ "$argument" == "__FAIL__" ]] && mode="failure"
  [[ "$argument" == "__HANG__" ]] && mode="hang"
done

if [[ "$mode" == "hang" ]]; then
  sleep 30
fi

printf 'argc=%s\n' "$#"
index=0
for argument in "$@"; do
  printf 'arg[%s]=%s\n' "$index" "$argument"
  index=$((index + 1))
done

if [[ "$mode" == "failure" ]]; then
  printf 'mock diagnostic\n' >&2
  exit 17
fi

printf 'mock final response\n'
