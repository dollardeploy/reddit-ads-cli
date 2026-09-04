---
name: reddit-ads-cli
description: Use when managing DollarDeploy's Reddit Ads from the terminal — viewing/editing campaigns, ad groups, ads, creatives/media, pulling performance reports, or inspecting the conversion pixel and sending CAPI conversion events. Triggers on "reddit ads", "reddit campaign", "reddit ad group", "reddit pixel", "conversion event", "reddit ads cli".
---

# Reddit Ads CLI (reddit-ads-cli)

Manage [Reddit Ads](https://ads-api.reddit.com) campaigns, ad groups, ads,
creatives/media, reports, and the conversion pixel + CAPI events from the
command line. Zero dependencies — native Node `fetch` against the Reddit Ads
API v3.

## Setup

The CLI auto-loads a `.env.production` file from the current directory on
startup, so run it from wherever that file lives (e.g. the repo root:
`node tools/reddit-ads-cli/cli.js ...`) and `REDDIT_CLIENT_ID`/
`REDDIT_CLIENT_SECRET` are picked up without exporting them. If you run from
`tools/reddit-ads-cli/` instead, export them yourself first:
`export $(grep -E '^REDDIT_(CLIENT_ID|CLIENT_SECRET)=' ../../.env.production | xargs)`.

```bash
node cli.js auth login          # one-time browser OAuth, stores tokens locally
node cli.js accounts list       # find the ad account id
node cli.js accounts use <id>   # set it as the default
```

Tokens are stored at `${XDG_CONFIG_HOME:-$HOME/.config}/reddit-ads-cli/session.json`
(`0600`) and auto-refresh. Run from `tools/reddit-ads-cli/`.

## Commands

| Task                  | Command                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Log in / status / out | `reddit-ads-cli auth login [--manual]` · `auth status` · `auth logout`                   |
| Businesses / profiles | `businesses list` · `profiles list`                                                      |
| Accounts              | `accounts list` · `accounts show <id>` · `accounts use <id>`                             |
| Campaigns             | `campaigns list\|show\|create\|edit\|pause\|resume [<id>] [flags]`                       |
| Ad groups             | `adgroups list [--campaign <id>]` · `adgroups create --campaign <id> ...`                |
| Ads                   | `ads list [--adgroup <id>]` · `ads pause <id>` · ...                                     |
| Creatives (read)      | `creatives list --profile <id>` · `creatives show <creative_asset_id>`                   |
| Reports               | `reports report [--level campaign\|ad_group\|ad] [--from -7d] [--to now] [--fields A,B]` |
| Pixel                 | `pixels list`                                                                            |
| Conversion event      | `events send --pixel <id> --type PURCHASE --value N --currency USD --email E`            |
| Raw endpoint          | `raw <METHOD> <path> [--body '<json>']`                                                  |

## Key behaviors

- **Typed flags** for `create`/`edit`: `--name`, `--status` (→ `configured_status`:
  ACTIVE/PAUSED/ARCHIVED/DELETED), `--objective`, `--bid`, `--goal`, `--pixel`,
  `--campaign`, `--adgroup`, `--start`, `--end`, `--spend-cap`. For any other
  field use repeatable **`--set key=value`** (dot-paths for nesting), or drop to
  **`raw`** for unwrapped endpoints.
- **`--json`** on any command prints the raw API response (good for `jq`).
- **Account:** `--account <id>` overrides the session default.
- **CAPI:** `events send` needs ≥1 attribution signal (`--email`,
  `--external-id`, `--click-id`, or `--ip`+`--user-agent`); PII is SHA256-hashed
  automatically. `--type` is upper-cased (PURCHASE, LEAD, SIGN_UP, …, or CUSTOM
  with `--custom-name`). Use `--test-id <id>` while validating.

## Safety

- `create`, `edit`, `pause`, `resume`, and `events send` mutate live ad data and
  can change real ad spend — confirm the account (`auth status`) and entity id
  first.
- `events send` reports real conversions unless `--test-id` is set.

## Library use

`require("./api.js")` → `RedditAdsAPI({ accessToken })` with `me`, `businesses`,
`businessAdAccounts`, `accounts`, `campaigns`, `adGroups`, `ads`, `pixels`,
`reports`, `creativeAssets`, `events`, and a low-level
`request(method, path, { query, body })`. See `README.md`.
