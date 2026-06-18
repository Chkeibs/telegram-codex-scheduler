# Telegram Codex Scheduler

A private, self-hosted Telegram bot that schedules prompts for the Codex CLI on your own computer or server.

Use Telegram buttons to choose a time, enter a prompt, select a project directory and filesystem permission, and confirm. At the requested time the bot runs the local `codex exec` command and sends the sanitized result back to you.

## What this project is

- A self-hosted Telegram interface and scheduler for Codex CLI.
- A Node.js process using Telegram long polling and a local SQLite file.
- A way to run Codex with authentication already configured on the host.
- Private by default through an explicit Telegram user-ID allowlist.

The bot does not connect Telegram users to OpenAI accounts. It never asks for or stores an OpenAI email, password, browser cookie, session token, API key, access token, or Codex auth file.

## What this project is not

- Not a public hosted bot.
- Not an OpenAI account-linking service.
- Not a way to bypass Codex limits or authentication.
- Not a ChatGPT Web login or scraping tool.
- Not a service where other people submit credentials.

Every person who clones this repository creates their own Telegram bot, installs Codex CLI, authenticates it locally, and runs their own private bot instance.

## How it works

```text
Telegram user
  -> allowlisted private Telegram bot
  -> persistent SQLite scheduler
  -> codex exec in a validated working directory
  -> sanitized result sent back to Telegram
```

The bot stores prompts and job metadata in `data/bot.sqlite`. It stores only a sanitized output preview, not the complete Codex response. In full-output mode, larger sanitized output is sent as a temporary text attachment and deleted immediately afterward.

## Requirements

- Node.js 24 LTS and npm.
- A Telegram bot token from [BotFather](https://t.me/BotFather).
- Your numeric Telegram user ID.
- [Codex CLI](https://developers.openai.com/codex/cli/) installed on the same host.
- Codex authenticated locally with `codex login` or another authentication mode you explicitly chose.
- Git and a machine that stays powered on, awake, and connected when jobs should run.
- On Linux, `bubblewrap` is recommended for reliable Codex sandboxing.

Windows users can run Codex natively, but WSL2 is a practical choice when the projects and bot already use Linux paths and tooling.

## Quick start

1. Clone and enter the repository:

   ```bash
   git clone https://github.com/your-name/telegram-codex-scheduler.git
   cd telegram-codex-scheduler
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a local environment file:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

4. In Telegram, open BotFather, create a bot, and put the new token in `.env`. Never reuse a token that has been pasted into a chat, issue, or commit; revoke it first.

5. Get your numeric Telegram user ID from a trusted method and add it to `ALLOWED_TELEGRAM_USER_IDS`. Separate multiple trusted IDs with commas.

6. Set `DEFAULT_WORKDIR` and `ALLOWED_WORKDIR_ROOTS` to real absolute paths owned by the bot's operating-system user.

7. Install Codex CLI using the current [official Codex CLI instructions](https://developers.openai.com/codex/cli/), then authenticate on this machine:

   ```bash
   codex login
   codex --ask-for-approval never exec --sandbox read-only "hello"
   ```

   On a headless server, prefer device authentication when available:

   ```bash
   codex login --device-auth
   ```

   The bot does not perform these steps and never reads your Codex credentials. See the [official authentication documentation](https://developers.openai.com/codex/auth/).

8. Build, test, and start:

   ```bash
   npm run build
   npm test
   npm start
   ```

Open the bot in Telegram and send `/start`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | required | New private token created with BotFather. |
| `ALLOWED_TELEGRAM_USER_IDS` | required | Comma-separated numeric user IDs allowed to use the bot. |
| `DEFAULT_TIMEZONE` | `Europe/Paris` | Initial IANA timezone for new users. |
| `DEFAULT_WORKDIR` | required | Initial project directory for new users. |
| `ALLOWED_WORKDIR_ROOTS` | default workdir | Comma-separated roots under which custom directories are permitted. |
| `DATABASE_PATH` | `./data/bot.sqlite` | Local SQLite file. |
| `CODEX_BIN` | `codex` | Executable name or absolute Codex binary path. Host-managed only. |
| `MAX_TELEGRAM_OUTPUT_CHARS` | `3500` | Initial per-user preview size; valid range 500–3900. |
| `SCHEDULER_INTERVAL_SECONDS` | `30` | Due-job polling interval. |
| `CONVERSATION_TTL_MINUTES` | `30` | Lifetime of an unfinished Telegram draft. |
| `CODEX_TIMEOUT_SECONDS` | `1800` | Maximum Codex execution time. |
| `MAX_CODEX_OUTPUT_BYTES` | `1048576` | Maximum captured bytes per stdout/stderr stream. |

Host settings are changed in `.env` and require a restart. Each allowed Telegram user can independently change their timezone, default project, preview length, and preview/full-output preference.

All configured roots must exist when the bot starts. Paths are resolved with their real filesystem location; symlinks cannot escape an allowed root. The bot process directory is also permitted because it is exposed as the “Bot directory” choice.

## Telegram interface

The main menu is entirely button-driven:

- Send scheduled message
- Send message now
- My scheduled messages
- Cancel scheduled message
- Settings
- Help

Slash-command shortcuts are also available:

- `/start`
- `/menu`
- `/schedule`
- `/run_now`
- `/jobs`
- `/cancel`
- `/settings`
- `/help`

### Scheduling a message

1. Tap **Send scheduled message**.
2. Choose a preset or enter one of:
   - `2026-06-19 07:00`
   - `19/06/2026 07:00`
   - `tomorrow 7am`
   - `tomorrow 07:00`
   - `in 2 hours`
3. Enter the Codex prompt.
4. Choose **Default project**, **Bot directory**, or **Custom directory**.
5. Choose the filesystem permission.
6. Review the exact time, prompt preview, directory, and permission.
7. Confirm or edit any field.

Times are interpreted in the user's configured timezone and stored internally in UTC. Existing jobs keep their original absolute time if the user's timezone later changes.

### Filesystem permissions

Every run defaults to **Read-only**.

- `Read-only`: Codex can inspect the project but cannot modify files.
- `Workspace write`: Codex can modify files inside the workspace. Telegram displays a warning before confirmation.

The bot never exposes `danger-full-access`. Runs use `--ask-for-approval never` because nobody can answer an interactive CLI approval at a scheduled time. A request outside the selected sandbox must fail instead of silently escalating.

The command is launched without a shell, and the entire prompt is passed as one argument:

```text
codex --ask-for-approval never exec --ephemeral --sandbox <read-only|workspace-write> <prompt>
```

For a validated directory that is not a Git repository, the bot adds `--skip-git-repo-check`. See [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

## Scheduling and restart behavior

- SQLite jobs move from `pending` to `running` in an atomic transaction before Codex starts.
- Scheduler ticks never overlap, and jobs execute sequentially.
- Pending overdue jobs run after the bot restarts.
- Jobs are never automatically retried.
- A process timeout marks the job failed.
- A job left `running` after a hard crash is eventually marked failed and is not requeued. This intentionally favors avoiding duplicate Codex execution.
- Telegram notification failure does not rerun Codex.
- Cancelling a job changes its status to `cancelled`; history is retained.

SQLite is a local file, not an external service. Stop the bot before making a consistent manual backup of `data/bot.sqlite` and its current WAL files, or use SQLite's backup tooling.

## Keeping the bot running with systemd

The repository includes [`deploy/systemd/telegram-codex-scheduler.service.example`](deploy/systemd/telegram-codex-scheduler.service.example).

Create a dedicated Linux user, place the project in `/opt/telegram-codex-scheduler`, then adjust the user, paths, and Node executable in the service. If Node was installed with a version manager, `which node` may not be `/usr/bin/node`.

```bash
sudo cp deploy/systemd/telegram-codex-scheduler.service.example /etc/systemd/system/telegram-codex-scheduler.service
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-codex-scheduler
sudo systemctl status telegram-codex-scheduler
sudo journalctl -u telegram-codex-scheduler -f
```

Run `codex login` as the same operating-system user declared in the service. That user's project roots must be readable, and writable when workspace-write jobs are desired.

## Oracle Cloud Free Tier

Oracle Cloud Infrastructure can provide an always-on Linux VM, but availability and free-tier rules can change. Read the current [Oracle Free Tier documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) and [Always Free resource details](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) before creating anything.

A modest starting configuration is:

- Ubuntu image.
- Ampere A1 `VM.Standard.A1.Flex` when available and marked Always Free eligible.
- 1 OCPU.
- 2 GB RAM minimum; 4 GB if available within current free limits.
- Around 50 GB boot volume, only if the console confirms it remains within free allowances.
- SSH key authentication.
- Public IPv4 for straightforward SSH administration, with inbound access restricted. Telegram long polling needs outbound HTTPS and no public bot/webhook port.

Suggested setup:

1. Create an Oracle Cloud account. A payment card may be requested for identity verification.
2. Choose the home region carefully; free compute availability is region-dependent.
3. Create an Always Free-eligible Ubuntu VM and verify every shape, storage, and network label before confirming.
4. Add an SSH public key and connect to the server.
5. Install Git, Node.js 24, npm, and `bubblewrap`.
6. Clone this repository and run `npm install`.
7. Create `.env`, set its mode to `600`, and configure the token, user allowlist, and safe project roots.
8. Install Codex CLI as the future systemd service user.
9. Run `codex login --device-auth`, then test `codex exec` manually.
10. Build and test the bot.
11. Install and enable the systemd unit.
12. Monitor the service, free-tier dashboard, disk use, and backups.

Warnings:

- Do not assume a resource is free merely because the account began as a free trial.
- Do not create a non-eligible shape, oversized volume, paid network service, or resource outside current limits.
- Ampere capacity may be unavailable in a chosen region.
- Oracle documents that sufficiently idle Always Free compute instances may be reclaimed.
- A stopped, deleted, reclaimed, full, or misconfigured VM cannot run scheduled jobs.
- Free hosting reduces monetary cost, not operational setup or maintenance.

## Other hosting choices

### Local Mac or PC

The easiest option for testing and costs nothing beyond the machine. It must stay awake, powered on, and online. Sleep prevents jobs from running until the bot returns.

### Small VPS

A paid VPS is often simpler and more predictable than free-tier capacity. Use a dedicated unprivileged service user, systemd, firewall rules, updates, and backups.

### Windows

Codex supports native Windows and WSL2. For an always-running Linux-style service, WSL2 or a Linux VM is generally easier, but WSL itself must remain running. The included systemd unit targets Linux.

## Security checklist

- Revoke any Telegram token ever pasted into chat, source code, an issue, or a commit.
- Never commit `.env`; it is ignored by Git.
- Keep `ALLOWED_TELEGRAM_USER_IDS` as small as possible.
- Treat the Telegram account itself as authority to run Codex; enable Telegram two-step verification.
- Never share `~/.codex/auth.json`, credential-store data, or access tokens.
- Do not paste secrets into Telegram prompts.
- Keep allowed working-directory roots narrow and use a dedicated OS user.
- Keep read-only as the default; choose workspace-write only for trusted prompts and projects.
- Protect and back up the SQLite database because it contains prompt text.
- Review server logs and update Node.js, dependencies, Codex, and the operating system.
- Do not expose the SQLite file, `.env`, project directory, or service account home over HTTP.

The bot removes its own configuration secrets from the Codex child environment and redacts known secret environment values from captured output. This is defense in depth, not a guarantee that a prompt cannot reveal secrets already stored inside an allowed project. Keep sensitive files outside allowed roots and use least privilege.

## Troubleshooting

### `codex` command not found

Run `codex --version` as the same OS user that runs the bot. Set `CODEX_BIN` to the correct executable or absolute path and restart.

### Codex is not logged in

Run `codex login` or `codex login --device-auth` as the service user, then test `codex exec` from the configured project directory.

### Telegram token invalid

Create or regenerate the token with BotFather, update `.env`, and restart. Never put the real token in `.env.example`.

### User not authorized

Verify the sender's numeric user ID in `ALLOWED_TELEGRAM_USER_IDS`. Usernames are not authorization identifiers.

### Working directory rejected

The directory must exist, be a directory, resolve inside `ALLOWED_WORKDIR_ROOTS`, and be accessible by the service user. Symlinks outside the roots are intentionally rejected.

### Server asleep or offline

Pending jobs run late when the process returns. A job that had already started before a crash is not retried.

### Job did not run at the exact second

Jobs run on the next scheduler poll and may wait behind an earlier Codex task. The default polling interval is 30 seconds.

### SQLite database is not writable

Check ownership and permissions for `DATABASE_PATH` and its parent directory. The bot creates the data directory and attempts mode `0600` for the database.

### systemd does not start

Inspect `systemctl status` and `journalctl`. Verify `User`, `WorkingDirectory`, `EnvironmentFile`, `ExecStart`, file ownership, Node path, Codex login user, and allowed roots.

### Oracle VM stopped or was reclaimed

Check the Oracle console, service limits, current Always Free eligibility, instance metrics, boot-volume state, and systemd status. Restore the database and configuration from a protected backup if replacement is necessary.

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

Tests use temporary in-memory databases and mocked Codex/Telegram boundaries. They do not need a real bot token or OpenAI credentials.

## License

[MIT](LICENSE)
