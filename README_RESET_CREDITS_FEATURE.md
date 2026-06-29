# Plan — Codex reset credits expiry feature

This document is a dedicated implementation plan for adding a Telegram bot feature that shows the user's available Codex rate-limit reset credits and their expiration dates.

It is intentionally separate from the main `README.md` so the feature can be designed, reviewed, implemented, tested, and deployed without changing the existing scheduling behavior.

## 1. Goal

Add a new button to the private Telegram bot:

```text
Codex reset credits
```

When the owner clicks it, the bot should wake the Google Cloud worker VM, query the locally authenticated Codex/ChatGPT account, and send back a safe Telegram summary:

```text
🎟️ Codex reset credits

Available: 2

1. Full reset (Weekly + 5 hr)
Status: available
Granted: 2026-01-10 09:00 Europe/Paris
Expires: 2026-02-09 09:00 Europe/Paris

2. Full reset (Weekly + 5 hr)
Status: available
Granted: 2026-01-20 14:30 Europe/Paris
Expires: 2026-02-19 14:30 Europe/Paris
```

The feature must never expose tokens, cookies, account IDs, user IDs, emails, auth files, or raw API responses.

## 2. What this feature is

This feature is a read-only status check for the same private self-hosted bot.

It answers:

- how many Codex rate-limit reset credits are available;
- when each available reset credit was granted;
- when each reset credit expires;
- whether a reset credit is available, redeemed, expired, or in another returned state;
- what kind of reset it is, for example `Full reset (Weekly + 5 hr)`.

## 3. What this feature is not

This feature is not:

- a public OpenAI account-linking system;
- a way to ask users for OpenAI credentials;
- a way to store OpenAI credentials in Firebase, Firestore, Telegram, or GitHub;
- a hosted multi-user service;
- a replacement for `codex login`;
- a feature that automatically consumes a reset credit;
- a feature that changes Codex limits;
- a feature that touches existing scheduled Codex jobs.

For the first implementation, it should only display reset credit information.

Consuming a reset credit from Telegram is explicitly out of scope for this feature plan.

## 4. Current verified behavior

There are two different Codex usage concepts that must not be confused.

### 4.1 Usage windows

Codex exposes rate-limit windows such as:

- short window, commonly around 5 hours;
- weekly window, commonly around 7 days.

These can be read through Codex App Server:

```text
account/rateLimits/read
```

This returns data such as:

- `rateLimits.primary.usedPercent`;
- `rateLimits.primary.windowDurationMins`;
- `rateLimits.primary.resetsAt`;
- `rateLimits.secondary.usedPercent`;
- `rateLimits.secondary.windowDurationMins`;
- `rateLimits.secondary.resetsAt`;
- `rateLimitResetCredits.availableCount`, in newer Codex versions.

This is useful, but it does not always include the expiration dates of individual manual reset credits.

### 4.2 Manual reset credits

The Codex app UI can show:

```text
2 resets available
```

These are manual rate-limit reset credits. They are not the same as the normal 5-hour and weekly usage windows.

The Codex app text indicates that a reset credit can expire after 30 days. The app UI has access to individual reset credit records with fields such as:

- `id`;
- `title`;
- `status`;
- `granted_at`;
- `expires_at`;
- `redeemed_at`;
- `description`.

The private endpoint observed from the Codex app is:

```text
GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

Important: this endpoint is not part of the public documented Codex App Server API. It should be treated as private/unstable. The implementation must be optional and resilient.

## 5. Architecture decision

The feature should be implemented as an isolated worker-side read-only capability.

Current bot architecture:

```text
Telegram
→ Firebase Function
→ Firestore
→ Cloud Tasks
→ Compute Engine worker VM
→ Codex CLI
→ Telegram result
```

New feature architecture:

```text
Telegram button
→ Firebase Function creates a usage/reset-credit check job
→ Cloud Task wakes VM
→ worker reads reset credits using local Codex auth
→ worker stores sanitized result
→ Firebase Function sends Telegram message
→ VM shuts down
```

The Firebase Function must not read Codex auth files. Only the worker VM, where Codex is already authenticated, may perform the reset-credit check.

## 6. Isolation requirements

This feature must not affect:

- scheduled message creation;
- immediate Codex execution;
- cancellation flow;
- job delivery flow;
- workdir selection;
- permission selection;
- existing Firestore job fields unless additive;
- existing worker shutdown behavior;
- existing Codex `exec` runner behavior.

Implementation should be additive:

- add a new Telegram menu button;
- add a new job kind;
- add a new worker service;
- add new tests;
- add new config flags;
- keep existing tests passing.

No existing flow should be rewritten unless strictly necessary.

## 7. Feature flag strategy

Because exact reset-credit expiration dates require a private/undocumented ChatGPT backend endpoint, this feature must be gated behind an explicit environment flag.

Recommended configuration:

```dotenv
ENABLE_CODEX_RESET_CREDIT_DETAILS=false
CODEX_RESET_CREDIT_DETAILS_MODE=disabled
```

Allowed modes:

```text
disabled
app_server_count_only
private_endpoint_details
```

### 7.1 `disabled`

Default for public repo safety.

Telegram response:

```text
Codex reset credit details are disabled on this bot.
Ask the bot owner to enable ENABLE_CODEX_RESET_CREDIT_DETAILS.
```

### 7.2 `app_server_count_only`

Uses only Codex App Server:

```text
account/rateLimits/read
```

Shows:

- reset credit available count if available;
- normal 5-hour and weekly usage windows;
- no per-credit expiration dates.

Telegram response example:

```text
🎟️ Codex reset credits

Available reset credits: 2

Expiration dates are not exposed by this Codex App Server response.
Enable private endpoint details if you want exact per-reset expiry dates.
```

### 7.3 `private_endpoint_details`

Uses the private ChatGPT backend endpoint observed from the Codex app:

```text
GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

Shows:

- available count;
- each reset title;
- each reset status;
- granted date;
- expiration date.

This should be clearly documented as self-hosted, best-effort, and potentially breakable if OpenAI changes the Codex app internals.

## 8. Data model plan

Avoid changing the core `CloudJob` model too aggressively.

Add a new job kind:

```ts
type JobKind = "scheduled" | "immediate" | "reset_credit_status";
```

For `reset_credit_status` jobs:

- `prompt` can be an empty string or a fixed internal label such as `__reset_credit_status__`;
- `workdirKey` can use the default key but should not be used;
- `filesystemPermission` should always be `read_only`;
- `codexMode` should not be `exec`, or a new field should indicate `internal_status_check`.

Preferred long-term model:

```ts
type CloudJobKind =
  | "scheduled"
  | "immediate"
  | "reset_credit_status";

type CloudJobAction =
  | "codex_exec"
  | "codex_reset_credit_status";
```

If introducing `CloudJobAction` is too invasive, keep it simple for MVP:

- add `reset_credit_status` as a new `kind`;
- branch inside the worker loop based on `job.kind`;
- make sure `reset_credit_status` never reaches `codexRunner`.

## 9. Telegram UX plan

### 9.1 Main menu

Current main menu:

```text
Send scheduled message
Send message now
My scheduled messages
Cancel scheduled message
Settings
Help
```

Add one new button:

```text
Codex reset credits
```

Recommended menu layout:

```text
Send scheduled message | Send message now
My scheduled messages | Cancel scheduled message
Codex reset credits   | Settings
Help
```

### 9.2 Slash commands

Add:

```text
/reset_credits
/usage
```

`/usage` can later show broader usage. For MVP, it can point to the same reset-credit handler or show reset credits plus normal usage windows.

### 9.3 Button response

When clicked:

```text
⏳ Checking Codex reset credits…

I may need to wake the worker VM. This can take a minute.
```

If job is queued:

```text
✅ Reset credit check queued.
I will send the result here when the worker responds.
```

When completed:

```text
🎟️ Codex reset credits

Available: 2

1. Full reset (Weekly + 5 hr)
Status: available
Granted: 2026-01-10 09:00 Europe/Paris
Expires: 2026-02-09 09:00 Europe/Paris

2. Full reset (Weekly + 5 hr)
Status: available
Granted: 2026-01-20 14:30 Europe/Paris
Expires: 2026-02-19 14:30 Europe/Paris
```

If no credits:

```text
🎟️ Codex reset credits

Available: 0

No available manual reset credits were found.
```

If exact details are disabled:

```text
🎟️ Codex reset credits

Available: 2

Exact per-reset expiration dates are disabled on this bot.
The owner can enable private endpoint details in the worker environment.
```

If Codex auth is missing:

```text
❌ Could not read Codex reset credits.

Codex is not authenticated on the worker VM.
Run `codex login --device-auth` on the VM, then try again.
```

If endpoint changes:

```text
❌ Could not read reset credit expiration dates.

Codex returned an unexpected response. The private reset-credit endpoint may have changed.
The normal scheduler is not affected.
```

## 10. Worker implementation plan

Add a new worker service:

```text
apps/worker/src/codexResetCreditsReader.ts
```

Responsibilities:

- read worker config;
- check feature mode;
- read local Codex authentication only on the worker VM;
- fetch reset credit details when enabled;
- sanitize the response;
- return a typed result object;
- never log raw tokens;
- never return raw auth fields.

### 10.1 Types

Add shared types:

```ts
export interface CodexResetCredit {
  idHash: string;
  title: string | null;
  status: string;
  grantedAt: Date | null;
  expiresAt: Date | null;
}

export interface CodexResetCreditsSnapshot {
  mode: "disabled" | "app_server_count_only" | "private_endpoint_details";
  availableCount: number | null;
  totalEarnedCount: number | null;
  credits: CodexResetCredit[];
  source: "codex_app_server" | "chatgpt_private_endpoint" | "disabled";
  warnings: string[];
}
```

Hash the reset credit `id` before storing or sending:

```text
RateLimitResetCredit_xxx → sha256 prefix, for example ab12cd34
```

Telegram does not need the raw credit ID.

### 10.2 Reading count through Codex App Server

Use Codex App Server when mode is `app_server_count_only`, or as fallback:

```text
codex app-server
initialize
account/rateLimits/read
```

Expected field in newer Codex versions:

```json
{
  "rateLimitResetCredits": {
    "availableCount": 2
  }
}
```

If missing, return a helpful warning:

```text
Your Codex CLI/App Server version does not expose reset credit count.
Try updating Codex.
```

### 10.3 Reading detailed expiry dates

When mode is `private_endpoint_details`, the worker should:

1. Read local Codex auth from the normal Codex auth location.
2. Extract the ChatGPT access token and account ID.
3. Send an authenticated GET request to:

   ```text
   https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
   ```

4. Validate response shape.
5. Keep only safe fields:

   ```text
   credits[].id, hashed only
   credits[].title
   credits[].status
   credits[].granted_at
   credits[].expires_at
   available_count
   total_earned_count
   ```

6. Drop unsafe or unnecessary fields:

   ```text
   profile_user_id
   profile_image_url
   raw description if not needed
   raw auth token
   raw account ID
   ```

7. Return a sanitized snapshot.

Important: do not add this endpoint call to Firebase Functions. Keep it VM-only.

## 11. Config plan

Add worker environment variables:

```dotenv
ENABLE_CODEX_RESET_CREDIT_DETAILS=false
CODEX_RESET_CREDIT_DETAILS_MODE=disabled
CODEX_RESET_CREDITS_TIMEOUT_SECONDS=20
CODEX_RESET_CREDITS_ENDPOINT=https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

Rules:

- if `ENABLE_CODEX_RESET_CREDIT_DETAILS=false`, mode must behave as `disabled`;
- if mode is `private_endpoint_details`, endpoint is required;
- endpoint host must be restricted to `chatgpt.com`;
- timeout must be short;
- no retries that could accidentally spam a private endpoint.

Potential validation:

```ts
CODEX_RESET_CREDIT_DETAILS_MODE:
  "disabled" | "app_server_count_only" | "private_endpoint_details"
```

## 12. Security plan

Security priorities:

- never expose auth tokens;
- never log raw `auth.json`;
- never send account ID or email to Telegram;
- never store raw reset credit IDs unless necessary;
- never allow non-allowlisted Telegram users;
- never allow arbitrary endpoint URL outside `chatgpt.com`;
- never consume reset credits in this read-only feature;
- never include this feature in public hosted mode because there is no public hosted mode.

The worker should use a minimal outbound request:

```text
GET /backend-api/wham/rate-limit-reset-credits
Authorization: Bearer [redacted]
ChatGPT-Account-Id: [redacted]
Accept: application/json
```

Logs should say:

```text
reset credit details fetched: available_count=2, credits=2
```

Logs must not say:

```text
Authorization: Bearer ...
ChatGPT-Account-Id: ...
profile_user_id: ...
```

## 13. Firestore storage plan

Do not store full raw endpoint responses.

Preferred storage for job result:

```json
{
  "availableCount": 2,
  "credits": [
    {
      "idHash": "ab12cd34",
      "title": "Full reset (Weekly + 5 hr)",
      "status": "available",
      "grantedAt": "2026-01-10T08:00:00.000Z",
      "expiresAt": "2026-02-09T08:00:00.000Z"
    }
  ],
  "warnings": []
}
```

If the existing job result only supports text previews, store a sanitized text preview only.

MVP recommendation:

- store sanitized Telegram-ready preview in `outputPreview`;
- do not add a new Firestore collection;
- do not persist full raw JSON.

## 14. Delivery formatting plan

Create a formatter:

```text
apps/functions/src/services/resetCreditsFormatter.ts
```

or shared package:

```text
packages/shared/src/resetCreditsFormatter.ts
```

Preferred shared package if both worker and functions need tests against the same formatting.

Formatting rules:

- display dates in the user's timezone;
- sort available credits by `expiresAt` ascending;
- show expired/redeemed only if returned and useful;
- limit output length;
- do not show raw ID;
- if exact dates are missing, explain why.

Example:

```text
🎟️ Codex reset credits

Available: 2

1. Full reset (Weekly + 5 hr)
Status: available
Granted: 18 Jun 2026, 03:13
Expires: 18 Jul 2026, 03:13

2. Full reset (Weekly + 5 hr)
Status: available
Granted: 27 Jun 2026, 02:45
Expires: 27 Jul 2026, 02:45
```

## 15. Worker job handling plan

In the worker loop:

```ts
if (job.kind === "reset_credit_status") {
  const snapshot = await codexResetCreditsReader.read();
  const preview = formatResetCredits(snapshot, userTimezone);
  await jobs.complete(job.id, { outputPreview: preview });
  return;
}
```

Guarantees:

- never call `codex exec`;
- never use workdir;
- never require filesystem permission;
- respect existing claim/idempotency logic;
- finish job exactly once;
- failure does not affect scheduled jobs.

## 16. Firebase Function plan

Add handler:

```text
handleResetCreditsRequest(ctx)
```

Responsibilities:

1. Ensure Telegram user is allowlisted.
2. Ensure user profile exists.
3. Create a `reset_credit_status` job.
4. Schedule a Cloud Task immediately.
5. Reply to Telegram that the check is queued.

Do not call ChatGPT/OpenAI directly from Firebase Functions.

Do not load Codex auth in Firebase Functions.

## 17. Cloud Tasks plan

Reuse existing immediate job wake mechanism.

For reset credit status:

- create job with `scheduledAt = now`;
- create wake task immediately;
- wake worker VM if stopped;
- worker claims and runs status check;
- worker completes job;
- result delivery is handled by existing delivery logic.

No new queue is required for MVP.

## 18. VM behavior plan

The VM may be stopped most of the time.

When the user asks for reset credits:

1. Cloud Task starts the VM.
2. Worker boots.
3. Worker claims the reset-credit job.
4. Worker reads Codex reset credits.
5. Worker writes sanitized result.
6. Existing delivery sends Telegram notification.
7. Worker goes idle.
8. Existing shutdown mechanism powers off the VM.

Cost impact should be tiny for occasional use, because it only boots the VM for a short read-only check.

## 19. Compatibility plan

Codex versions differ.

Known verified behavior:

- Codex CLI `0.140.0` App Server can expose usage windows but may not expose detailed reset-credit expiry dates.
- Codex app bundled CLI `0.142.3` exposes `rateLimitResetCredits.availableCount` through App Server.
- The detailed list with `expires_at` comes from the private ChatGPT backend endpoint used by the Codex app.

Implementation should detect:

- Codex not installed;
- Codex not logged in;
- App Server method missing;
- `rateLimitResetCredits` field missing;
- private endpoint returns 401/403;
- private endpoint response shape changed.

Each case should produce a clear Telegram error without breaking other bot flows.

## 20. Test plan

Add tests without requiring real Codex auth.

### 20.1 Unit tests

Add tests for:

- parsing detailed reset credit response;
- parsing count-only App Server response;
- missing `rateLimitResetCredits`;
- expired credits;
- redeemed credits;
- available credits;
- invalid `expires_at`;
- sorting by expiry date;
- timezone formatting;
- redaction of IDs and sensitive fields;
- output length limits;
- disabled feature mode;
- endpoint host validation.

### 20.2 Worker tests

Mock:

- Codex App Server process;
- private endpoint fetch;
- Firestore job repository;
- job completion;
- job failure.

Cases:

- `reset_credit_status` job does not call `codexRunner`;
- successful private endpoint response completes job;
- private endpoint 401 marks job failed with safe error;
- private endpoint shape change marks job failed with safe error;
- App Server count-only fallback works;
- timeout marks job failed;
- no auth file gives helpful error;
- raw token never appears in output.

### 20.3 Telegram tests

Add tests for:

- main menu contains `Codex reset credits`;
- `/reset_credits` creates a job;
- unauthorized user cannot create reset-credit job;
- queued message is sent;
- completion message format is safe;
- errors are safe and understandable.

### 20.4 Regression tests

Existing tests must remain green:

```text
npm run build
npm run typecheck
npm test
```

Also verify:

- scheduled jobs still work;
- immediate jobs still work;
- cancellation still works;
- settings still work;
- VM shutdown still works.

## 21. Manual smoke test plan

Use a fake reset-credit response first.

### 21.1 Local mocked test

1. Add mocked endpoint response.
2. Run worker logic locally.
3. Confirm Telegram preview text.
4. Confirm no token appears in logs.

### 21.2 VM mocked test

1. Deploy code to worker VM.
2. Configure mode:

   ```dotenv
   CODEX_RESET_CREDIT_DETAILS_MODE=app_server_count_only
   ```

3. Click Telegram button.
4. Confirm VM wakes.
5. Confirm result arrives.
6. Confirm VM shuts down.

### 21.3 Private endpoint test

Only after mocked tests pass:

1. Configure mode:

   ```dotenv
   ENABLE_CODEX_RESET_CREDIT_DETAILS=true
   CODEX_RESET_CREDIT_DETAILS_MODE=private_endpoint_details
   ```

2. Ensure Codex is logged in on VM:

   ```bash
   codex login status
   ```

3. Click Telegram button.
4. Confirm Telegram shows available reset credits and expiration dates.
5. Check worker logs for leaks:

   ```bash
   journalctl -u telegram-codex-worker --since "10 minutes ago"
   ```

6. Confirm no token, account ID, email, or raw auth JSON appears.

## 22. Deployment plan

### 22.1 Branch

Create a dedicated branch:

```bash
git checkout -b codex/reset-credit-expiry
```

### 22.2 Implement in small commits

Recommended commits:

1. Add shared types and formatter.
2. Add worker reset-credit reader.
3. Add worker job-kind handling.
4. Add Firebase Telegram button and command.
5. Add tests.
6. Update docs and `.env.example`.

### 22.3 Deploy

Deploy Functions:

```bash
npm run build
npm test
npm --prefix apps/functions run deploy
```

Deploy worker:

```bash
git pull
npm ci
npm run build
sudo systemctl restart telegram-codex-worker
```

Exact commands may differ depending on the current deployment scripts.

### 22.4 Rollback

Rollback must be easy:

- disable feature flag;
- redeploy previous worker if needed;
- remove Telegram button later if desired.

Emergency disable:

```dotenv
ENABLE_CODEX_RESET_CREDIT_DETAILS=false
CODEX_RESET_CREDIT_DETAILS_MODE=disabled
```

## 23. README update plan

After implementation, update the main README with a short section only.

Do not overload the main README.

Add:

- what the feature does;
- that it is optional;
- that exact expiry dates use a private/unstable Codex app backend endpoint;
- how to enable/disable;
- troubleshooting.

Link to this document for the full plan:

```text
See README_RESET_CREDITS_FEATURE.md
```

## 24. Risks

### 24.1 Private endpoint changes

The detailed endpoint is not public stable API. OpenAI may change:

- URL;
- auth headers;
- field names;
- response structure;
- availability.

Mitigation:

- feature flag off by default;
- safe fallback to count-only mode;
- clear Telegram error;
- no effect on scheduling.

### 24.2 Auth token handling

Reading detailed expiry requires using local ChatGPT auth.

Mitigation:

- only worker VM reads auth;
- no Firebase auth access;
- no Telegram token output;
- no raw logs;
- sanitize all errors;
- test redaction.

### 24.3 User confusion

Users may confuse:

- normal usage window resets;
- manual reset credits.

Mitigation:

Telegram copy should say:

```text
These are manual reset credits, not the normal 5h/weekly automatic reset windows.
```

### 24.4 Accidental redemption

The private endpoint also has a consume action.

Mitigation:

- do not implement consume;
- do not expose `Use reset` from Telegram;
- only use GET/read endpoint;
- tests verify no consume endpoint is called.

## 25. Acceptance criteria

The feature is complete only when:

- Telegram menu has a reset-credit button;
- `/reset_credits` works;
- unauthorized users are blocked;
- a read-only reset-credit job is created;
- worker handles the job without calling `codex exec`;
- result returns to Telegram;
- exact expiry dates show when private endpoint mode is enabled;
- count-only mode works without private endpoint;
- disabled mode is safe;
- no secrets appear in logs, Firestore, Telegram, or tests;
- all existing tests still pass;
- new tests cover success, failure, disabled, and secret-redaction cases;
- VM still shuts down after the job;
- main scheduling functionality is unaffected.

## 26. Implementation order

Recommended order:

1. Add config flags.
2. Add shared parser and formatter.
3. Add tests for parser and formatter.
4. Add worker reset-credit reader with mocked fetch.
5. Add worker job handling.
6. Add Firestore job kind support.
7. Add Telegram button and command.
8. Add integration tests.
9. Run full local verification.
10. Deploy to VM in disabled mode.
11. Test count-only mode.
12. Test private endpoint mode.
13. Inspect logs for leaks.
14. Update main README with a short link.
15. Commit and push.

## 27. Final recommended MVP

Build the first version as:

```text
Read-only reset-credit expiry viewer
```

Supported:

- Telegram button;
- available count;
- per-reset expiry dates in private mode;
- safe count-only fallback;
- no reset consumption.

Deferred:

- consume reset from Telegram;
- automatic reminders before expiry;
- scheduled “warn me before reset expires” notifications;
- multi-provider usage dashboards;
- historical reset-credit storage.

Once this MVP is stable, the next natural feature would be:

```text
Notify me 3 days before a reset credit expires
```

That should be a separate plan and a separate implementation.
