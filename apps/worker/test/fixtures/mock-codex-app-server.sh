#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r request; do
  if [[ "$request" == *'"id":1'* ]]; then
    printf '%s\n' '{"id":1,"result":{"userAgent":"mock"}}'
  elif [[ "$request" == *'"id":2'* ]]; then
    printf '%s\n' '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":43,"windowDurationMins":300,"resetsAt":1788241059},"secondary":{"usedPercent":29,"windowDurationMins":10080,"resetsAt":1788747939}},"rateLimitsByLimitId":null,"rateLimitResetCredits":{"availableCount":1,"credits":[{"status":"available","expiresAt":1788816739,"title":"Rate-limit reset"}]}}}'
  fi
done
