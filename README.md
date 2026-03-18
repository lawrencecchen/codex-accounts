# codex-accounts

Manage multiple OpenAI Codex accounts from the terminal. See rate limits across all your accounts at a glance and switch between them instantly.

```
$ cx

1) alice@company.com [pro] (active)
   5h limit                    : ████████████████████ 83.0% left  resets in 3h 14m
   7d limit                    : ████████████████████ 32.0% left  resets in 2d 14h

2) bob@startup.io [pro]
   5h limit                    : ████████████████████ 100.0% left resets in 5h
   7d limit                    : ████████████████████   0.0% left resets in 13h

3) work (api key)

Switch to (#): _
```

## Install

```bash
npm i -g codex-accounts
```

Requires Node 18+ and [Codex CLI](https://github.com/openai/codex) installed.

## Usage

Run `cx` with no arguments for the interactive view: see usage for every account, then type a number to switch.

```
cx                    Interactive: show all accounts + switch
cx add                Add account via OAuth (opens codex login)
cx add-key            Add an API key account
cx import             Import current ~/.codex/auth.json
cx list               List all accounts
cx switch [email]     Switch active account (interactive if no email)
cx remove <email>     Remove an account
cx status             Show usage (non-interactive)
```

## Adding accounts

Each `cx add` opens the Codex OAuth flow in your browser. Log in with a different account each time. Accounts are identified by email, no name required.

```bash
cx add          # opens browser, log in with account #1
cx add          # opens browser, log in with account #2
cx add          # ...
```

Already logged in? Import your current session without re-authenticating:

```bash
cx import
```

For API key accounts (no usage tracking, just switching):

```bash
cx add-key
```

## What it shows

For each OAuth account, `cx` fetches rate limits from the OpenAI API and displays:

- **5h rolling limit** with percentage remaining and reset countdown
- **Weekly limit** with percentage remaining and reset countdown
- **Additional model-specific limits** (e.g. GPT-5.3-Codex-Spark)
- **Plan type** (free, pro, plus, team, etc.)
- **Credits balance**

Color-coded bars: green (<70% used), yellow (70-90%), red (90%+).

All accounts are fetched in parallel.

## Switching

`cx switch` with no argument shows an interactive picker. You can also pass an email or partial match:

```bash
cx switch alice@company.com
cx switch alice                  # partial match works
cx switch startup                # matches bob@startup.io
```

Switching writes to `~/.codex/auth.json`. Restart running Codex sessions to pick up the new account.

## How it works

Credentials are stored in `~/.codex-accounts/accounts/` (one file per account, mode 0600). The active account lives in `~/.codex/auth.json`, which is the standard Codex CLI auth file.

OAuth tokens are refreshed automatically when expired via `https://auth.openai.com/oauth/token`. Rate limits come from the same `/wham/usage` endpoint that the Codex CLI and ChatGPT use internally.

Zero runtime dependencies.

## License

MIT
