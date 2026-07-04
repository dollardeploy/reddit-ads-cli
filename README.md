# Reddit Ads CLI (reddit-ads-cli)

Manage DollarDeploy's [Reddit Ads](https://ads-api.reddit.com) from the command
line — campaigns, ad groups, ads, creatives/media, performance reports, and the
conversion pixel + server-side conversion (CAPI) events. Zero dependencies —
uses native Node `fetch` against the Reddit Ads API v3.

## Setup

You need a Reddit OAuth app (script/web app) at
<https://www.reddit.com/prefs/apps> with a redirect URI of
`http://localhost:8080`. Its credentials live in `.env.prod`:

export REDDIT_CLIENT_ID=<your-client-id>
export REDDIT_CLIENT_SECRET=<your-client-secret>

Then authenticate once (opens a browser, stores tokens locally):

```bash
reddit-ads-cli auth login
```

`login` requests scopes `adsread adsedit adsconversions` with
`duration=permanent`, so Reddit issues a refresh token. The session (access +
refresh token, expiry, default account) is stored at
`${XDG_CONFIG_HOME:-$HOME/.config}/reddit-ads-cli/session.json` with `0600`
permissions. Every command auto-refreshes the access token when it is near
expiry.

## Usage

```bash
reddit-ads-cli <group> <command> [options]
```

## Auth & accounts

| Task                 | Command                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| Log in (loopback)    | `reddit-ads-cli auth login`                                                  |
| Log in (paste code)  | `reddit-ads-cli auth login --manual`                                         |
| Custom redirect/port | `reddit-ads-cli auth login --redirect-uri http://localhost:9000 --port 9000` |
| Session status       | `reddit-ads-cli auth status`                                                 |
| Log out              | `reddit-ads-cli auth logout`                                                 |
| List businesses      | `reddit-ads-cli businesses list`                                             |
| List profiles        | `reddit-ads-cli profiles list`                                               |
| List ad accounts     | `reddit-ads-cli accounts list`                                               |
| Show an account      | `reddit-ads-cli accounts show <account_id>`                                  |
| Set default account  | `reddit-ads-cli accounts use <account_id>`                                   |

After `accounts use <id>`, the account id is stored in the session and used by
all account-scoped commands. Override per-command with `--account <id>`.

`businesses list`, `profiles list`, and `accounts list` enumerate across your
businesses (Reddit has no flat list endpoint for these). Use a profile id from
`profiles list` with `creatives list --profile <id>`. Running any group with no
command (e.g. `reddit-ads-cli campaigns`) prints that group's commands.

## Campaigns / ad groups / ads

The three levels share the same verbs (`list`, `show`, `create`, `edit`,
`pause`, `resume`):

| Task              | Command                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| List campaigns    | `reddit-ads-cli campaigns list`                                           |
| Show a campaign   | `reddit-ads-cli campaigns show <id>`                                      |
| Create a campaign | `reddit-ads-cli campaigns create --name "Launch" --objective CONVERSIONS` |
| Edit a campaign   | `reddit-ads-cli campaigns edit <id> --name "Launch v2"`                   |
| Pause / resume    | `reddit-ads-cli campaigns pause <id>` / `... resume <id>`                 |
| List ad groups    | `reddit-ads-cli adgroups list [--campaign <id>]`                          |
| Create ad group   | `reddit-ads-cli adgroups create --campaign <id> --name "AG" --bid 150`    |
| List ads          | `reddit-ads-cli ads list [--adgroup <id>]`                                |
| Pause an ad       | `reddit-ads-cli ads pause <id>`                                           |

Typed flags for `create`/`edit`: `--name`, `--status` (→ `configured_status`,
one of `ACTIVE`/`PAUSED`/`ARCHIVED`/`DELETED`), `--objective`, `--bid`
(→ `bid_value`), `--goal` (→ `goal_value`), `--pixel` (→ `conversion_pixel_id`),
`--campaign` (→ `campaign_id`), `--adgroup` (→ `ad_group_id`), `--start`
(→ `start_time`), `--end` (→ `end_time`), `--spend-cap` (→ `spend_cap`).
`pause`/`resume` set `configured_status` to `PAUSED`/`ACTIVE`. For any field not
covered by a typed flag, use `--set`:

```bash
reddit-ads-cli campaigns edit <id> --set goal.value=5000 --set spend_cap=20000
```

`--set key=value` is repeatable and supports dot-paths for nested fields. It is
merged on top of the typed flags.

## Creatives

The Reddit Ads API v3 exposes creative assets read-only here (creation and media
upload go through the Reddit UI or the more involved posts/creative flow — use
`raw` for those):

| Task          | Command                                                |
| ------------- | ------------------------------------------------------ |
| List assets   | `reddit-ads-cli creatives list --profile <profile_id>` |
| Show an asset | `reddit-ads-cli creatives show <creative_asset_id>`    |

Find profile ids with `reddit-ads-cli profiles list`. The default (non-`--json`)
output is a table of `ID  TYPE  STATUS  MEDIA_URL  COVER_URL`.

## Reports

```bash
# Last 7 days, per campaign (defaults), as JSON:
reddit-ads-cli reports report --json

# Explicit window and fields:
reddit-ads-cli reports report --level ad_group --from -30d --to now \
  --fields AD_GROUP_ID,SPEND,IMPRESSIONS,CLICKS,CTR,CONVERSION_PURCHASE_TOTAL_VALUE --json
```

- `--from` / `--to` accept an ISO date/datetime, `now`, or a relative offset
  like `-7d`, `-30d`, `+3h` (units `s`/`m`/`h`/`d`/`w`). They are converted to
  ISO automatically. Defaults: `--from -7d`, `--to now`.
- `--level` (`campaign` (default), `ad_group`, or `ad`) sets the breakdown
  dimension (`CAMPAIGN_ID`/`AD_GROUP_ID`/`AD_ID`); override directly with
  `--breakdowns A,B`.
- `--fields A,B,C` is a comma-separated list of Reddit report field names
  (upper-cased automatically), e.g. `SPEND`, `IMPRESSIONS`, `CLICKS`, `CTR`,
  `CPC`, `ECPM`, `KEY_CONVERSION_TOTAL_COUNT`, `CONVERSION_PURCHASE_TOTAL_VALUE`,
  `CONVERSION_ROAS`. Defaults to a spend/clicks/CTR summary plus the level id.
  (`--metrics` is accepted as an alias.)
- Optional `--time-zone <IANA tz>` (e.g. `--time-zone America/New_York`).

## Pixel & conversion events (CAPI)

| Task          | Command                      |
| ------------- | ---------------------------- |
| List pixels   | `reddit-ads-cli pixels list` |
| Send an event | see below                    |

```bash
reddit-ads-cli events send --pixel <pixel_id> --type PURCHASE \
  --value 49.99 --currency USD --email user@example.com --click-id <rdt_cid>
```

`--type` is a Reddit tracking type: `PAGE_VISIT`, `VIEW_CONTENT`, `SEARCH`,
`ADD_TO_CART`, `ADD_TO_WISHLIST`, `PURCHASE`, `LEAD`, `SIGN_UP`, or `CUSTOM`
(with `--custom-name <name>`); it is upper-cased automatically. Each event must
include at least one attribution signal: `--email`, `--external-id`,
`--click-id`, or `--ip` + `--user-agent`. PII (`--email`, `--external-id`,
`--ip`) is SHA256-hashed (lowercased) before sending; `--click-id` is sent raw.
Optional: `--action-source` (default `WEBSITE`), `--currency`, `--conversion-id`,
and `--test-id <id>` to flag the event as a test in Reddit's Events Manager.

## Escape hatch

For any endpoint not wrapped above:

```bash
reddit-ads-cli raw GET /accounts/<id>/funding_instruments --json
reddit-ads-cli raw PATCH /accounts/<id>/campaigns/<cid> --body '{"status":"PAUSED"}'
```

## Key behaviors

- **`--json`** on any command prints the raw API response (good for `jq`/agents).
- Credential resolution: `--client-id`/`--secret` flags > `REDDIT_CLIENT_ID`/
  `REDDIT_CLIENT_SECRET` env. Base URL override: `--base-url`.
- Account resolution: `--account` flag > session `default_account_id`.
- On HTTP 429 the client retries with backoff using `X-RateLimit-Reset`.
- Errors print Reddit's message plus the HTTP status and exit non-zero.

## Safety notes

- `create`, `edit`, `pause`, `resume`, `media upload`, and `events send` mutate
  live ad data and can change real ad spend — confirm the account id
  (`auth status`) and entity id before running.
- `events send` reports real conversions; use `--test` while validating.

## Library use

`api.js` can be required directly:

```js
const RedditAdsAPI = require("@dollardeploy/reddit-ads-cli/api.js");
const api = RedditAdsAPI({ accessToken });
await api.campaigns.list(accountId);
```

It exposes `me`, `businesses`, `businessAdAccounts`, `businessProfiles`,
`accounts`, `campaigns`, `adGroups`, `ads`, `pixels`, `reports`,
`creativeAssets`, `events`, and a low-level
`request(method, path, { query, body })`. `campaigns`/`adGroups`/`ads`
have `list(accountId)` / `create(accountId, body)` (account-scoped) and
`get(id)` / `update(id, body)` (by entity id). `auth.js` exposes the OAuth helpers
(`buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, `getValidAccessToken`,
session read/write, `hashPII`).
