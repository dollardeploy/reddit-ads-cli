#!/usr/bin/env node
"use strict";

// Nearest .env.production at or above the current directory, else at or above this script.
// The file lives only in the main checkout, so this also works from a Gene workspace under .gene/
{
  const fs = require("node:fs");
  const path = require("node:path");
  const findUp = dir => {
    const file = path.join(dir, ".env.production");
    if (fs.existsSync(file)) {
      return file;
    }
    const parent = path.dirname(dir);
    return parent === dir ? undefined : findUp(parent);
  };
  const envFile = findUp(process.cwd()) ?? findUp(__dirname);
  if (envFile) {
    process.loadEnvFile(envFile);
  }
}

const auth = require("./auth.js");

const parseArgs = argv => {
  const positionals = [];
  const flags = {};
  const sets = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    if (name === "set" && hasValue) {
      sets.push(next);
      i++;
      continue;
    }
    if (hasValue) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { _: positionals, flags, sets };
};

const setDotPath = (obj, path, value) => {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cursor[parts[i]] !== "object" || cursor[parts[i]] === null) {
      cursor[parts[i]] = {};
    }
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return obj;
};

const buildBodyFromSets = sets => {
  const body = {};
  for (const entry of sets) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      continue;
    }
    setDotPath(body, entry.slice(0, eq), entry.slice(eq + 1));
  }
  return body;
};

const buildConversionEvent = ({
  type,
  customName,
  actionSource,
  value,
  currency,
  conversionId,
  email,
  externalId,
  clickId,
  ip,
  userAgent
}) => {
  const hasSignal = email || externalId || clickId || (ip && userAgent);
  if (!hasSignal) {
    throw new Error(
      "Conversion event needs at least one attribution signal (email, external-id, click-id, or ip+user-agent)"
    );
  }
  const user = {};
  if (email) {
    user.email = auth.hashPII(email);
  }
  if (externalId) {
    user.external_id = auth.hashPII(externalId);
  }
  if (ip) {
    user.ip_address = auth.hashPII(ip);
  }
  if (userAgent) {
    user.user_agent = userAgent;
  }
  const trackingType = String(type || "").toUpperCase();
  const eventType = { tracking_type: trackingType };
  if (trackingType === "CUSTOM" && customName) {
    eventType.custom_event_name = customName;
  }
  const event = {
    event_at: new Date().toISOString(),
    action_source: (actionSource || "WEBSITE").toUpperCase(),
    type: eventType,
    user
  };
  if (clickId) {
    event.click_id = clickId;
  }
  const metadata = {};
  if (value !== undefined) {
    metadata.value = value;
  }
  if (currency) {
    metadata.currency = currency;
  }
  if (conversionId) {
    metadata.conversion_id = conversionId;
  }
  if (Object.keys(metadata).length) {
    event.metadata = metadata;
  }
  return event;
};

const RedditAdsAPI = require("./api.js");
const crypto = require("node:crypto");
const fs = require("node:fs");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

// Credentials come from flags, then env, then the saved session (persisted at
// login so the stored refresh token can be exchanged without re-passing creds).
const resolveCredentials = (flags, session) => {
  const clientId =
    flags["client-id"] || process.env.REDDIT_CLIENT_ID || (session && session.client_id);
  const clientSecret =
    flags.secret || process.env.REDDIT_CLIENT_SECRET || (session && session.client_secret);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing credentials: set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (or pass --client-id/--secret)"
    );
  }
  return { clientId, clientSecret };
};

const resolveAccount = (flags, session) => {
  const accountId = flags.account || (session && session.default_account_id);
  if (!accountId) {
    throw new Error(
      "No ad account: pass --account <id> or run `reddit-ads-cli accounts use <id>`"
    );
  }
  return accountId;
};

const print = (data, flags) => {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const payload = data && typeof data === "object" && "data" in data ? data.data : data;
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      process.stdout.write("(no results)\n");
      return;
    }
    payload.forEach(row => {
      if (!row || typeof row !== "object") {
        process.stdout.write(`${row}\n`);
        return;
      }
      const id = row.id || row.asset_id || "";
      const label = row.name || row.title || row.username || row.headline || row.type || "";
      const status = row.configured_status || row.effective_status || row.status || "";
      const line = [id, label, status].filter(Boolean).join("\t");
      process.stdout.write(`${line || JSON.stringify(row)}\n`);
    });
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
};

// Creative assets are wrapped as { result: { id, type, status, media: { permanent_url } } }.
const formatCreatives = data => {
  const raw = data && data.data !== undefined ? data.data : data;
  const items = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  if (items.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }
  process.stdout.write(["ID", "TYPE", "STATUS", "MEDIA_URL", "COVER_URL"].join("\t") + "\n");
  for (const item of items) {
    const asset = item.result || item;
    const media = asset.media || {};
    const mediaUrl = media.permanent_url || asset.media_url || "";
    const coverUrl =
      media.cover_url || asset.cover_url || asset.preview_url || asset.thumbnail_url || "";
    process.stdout.write(
      [asset.id || "", asset.type || "", asset.status || "", mediaUrl, coverUrl].join("\t") +
        "\n"
    );
  }
};

// Monetary/bid fields are integers in microcurrency (1 USD = 1,000,000).
const MICROS_PER_USD = 1_000_000;
const NUMERIC_FIELDS = new Set(["bid_value", "goal_value", "spend_cap"]);
const REQUIRED_UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign"];

const splitCsv = value =>
  String(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

const typedBody = flags => {
  const body = {};
  const map = {
    name: "name",
    status: "configured_status",
    objective: "objective",
    bid: "bid_value",
    goal: "goal_value",
    pixel: "conversion_pixel_id",
    campaign: "campaign_id",
    adgroup: "ad_group_id",
    start: "start_time",
    end: "end_time",
    "spend-cap": "spend_cap",
    post: "post_id",
    "click-url": "click_url"
  };
  for (const [flag, field] of Object.entries(map)) {
    if (flags[flag] !== undefined) {
      body[field] = NUMERIC_FIELDS.has(field) ? Number(flags[flag]) : flags[flag];
    }
  }
  if (flags["daily-usd"] !== undefined) {
    body.goal_type = "DAILY_SPEND";
    body.goal_value = Math.round(Number(flags["daily-usd"]) * MICROS_PER_USD);
  }
  if (flags.geo !== undefined) {
    body.targeting = { ...body.targeting, geolocations: splitCsv(flags.geo) };
  }
  return body;
};

// Guards every create/edit: ad URLs must be attributable, daily budgets must stay under
// REDDIT_ADS_MAX_DAILY_USD when it is set (the per-entity hard cap for automated runs).
const assertSafeBody = (body, env = process.env) => {
  if (body.click_url) {
    const params = new URL(body.click_url).searchParams;
    const missing = REQUIRED_UTM_PARAMS.filter(param => !params.get(param));
    if (missing.length) {
      throw new Error(
        `click_url is missing ${missing.join(", ")}: tag every ad URL, e.g. ?utm_source=reddit&utm_medium=paid&utm_campaign=<name>`
      );
    }
  }
  const maxDailyUsd = Number(env.REDDIT_ADS_MAX_DAILY_USD);
  if (maxDailyUsd > 0 && body.goal_type === "DAILY_SPEND" && body.goal_value !== undefined) {
    if (body.goal_value > maxDailyUsd * MICROS_PER_USD) {
      throw new Error(
        `Daily budget $${body.goal_value / MICROS_PER_USD} exceeds REDDIT_ADS_MAX_DAILY_USD=$${maxDailyUsd}`
      );
    }
  }
  return body;
};

const buildEntityBody = (flags, sets) => {
  const typed = typedBody(flags);
  const fromSets = buildBodyFromSets(sets);
  const targeting =
    typed.targeting || fromSets.targeting
      ? { targeting: { ...fromSets.targeting, ...typed.targeting } }
      : {};
  return assertSafeBody({ ...typed, ...fromSets, ...targeting });
};

const buildPostBody = flags => {
  if (!flags.headline || !flags.image || !flags.url) {
    throw new Error("posts create requires --headline, --image <public media_url> and --url");
  }
  assertSafeBody({ click_url: flags.url });
  return {
    type: "IMAGE",
    headline: flags.headline,
    allow_comments: !flags["no-comments"],
    content: [
      {
        media_url: flags.image,
        destination_url: flags.url,
        call_to_action: flags.cta || "Learn More",
        ...(flags["display-url"] ? { display_url: flags["display-url"] } : {})
      }
    ]
  };
};

const requireProfile = flags => {
  if (!flags.profile) {
    throw new Error("this command requires --profile <profile_id> (see `profiles list`)");
  }
  return flags.profile;
};

// Reddit rejects an ad without configured_status with a bare 400, so ask for it up front
const requireStatus = flags => {
  if (!["ACTIVE", "PAUSED"].includes(flags.status)) {
    throw new Error("this command requires --status ACTIVE|PAUSED");
  }
};

// list/create are account-scoped; show/edit/pause/resume address the entity by its own id.
const resourceCommands = (resource, getAccount, flags, sets, id) => ({
  list: () =>
    resource.list(getAccount(), { campaign_id: flags.campaign, ad_group_id: flags.adgroup }),
  show: () => resource.get(id()),
  create: () => resource.create(getAccount(), buildEntityBody(flags, sets)),
  // goal_type is fixed at creation and PATCH rejects it; it is only needed for the cap check above
  edit: () => {
    const { goal_type: _goalType, ...body } = buildEntityBody(flags, sets);
    return resource.update(id(), body);
  },
  pause: () => resource.update(id(), { configured_status: "PAUSED" }),
  resume: () => resource.update(id(), { configured_status: "ACTIVE" })
});

// Reddit has no "list ad accounts" / "list profiles" endpoint; enumerate via businesses.
const listUnderBusinesses = async (api, fetchChildren) => {
  const businesses = (await api.businesses()).data || [];
  const out = [];
  for (const business of businesses) {
    const children = (await fetchChildren(business.id)).data || [];
    for (const child of children) {
      out.push({ ...child, business_id: business.id });
    }
  }
  return { data: out };
};

const dispatch = async ({ group, command, positionals, flags, sets, api, getAccount }) => {
  const id = () => positionals[0];
  const groups = {
    businesses: {
      list: () => api.businesses()
    },
    profiles: {
      list: () => listUnderBusinesses(api, businessId => api.businessProfiles(businessId))
    },
    accounts: {
      list: () => listUnderBusinesses(api, businessId => api.businessAdAccounts(businessId)),
      show: () => api.accounts.get(id() || getAccount())
    },
    campaigns: resourceCommands(api.campaigns, getAccount, flags, sets, id),
    adgroups: resourceCommands(api.adGroups, getAccount, flags, sets, id),
    ads: {
      ...resourceCommands(api.ads, getAccount, flags, sets, id),
      create: () => {
        requireStatus(flags);
        return api.ads.create(getAccount(), buildEntityBody(flags, sets));
      }
    },
    creatives: {
      list: () => api.creativeAssets.list(requireProfile(flags)),
      show: () => api.creativeAssets.get(id())
    },
    posts: {
      list: () => api.posts.list(requireProfile(flags)),
      show: () => api.posts.get(id()),
      create: () => api.posts.create(requireProfile(flags), buildPostBody(flags))
    },
    pixels: {
      list: () => api.pixels.list(getAccount())
    }
  };
  const handler = groups[group] && groups[group][command];
  if (!handler) {
    throw new Error(`Unknown command: ${group} ${command || ""}`.trim());
  }
  return handler();
};

// Resolve a date input to an ISO 8601 string. Accepts "now", an ISO/parseable
// date, or a relative offset like "-7d", "+3h" (units: s, m, h, d, w).
// Reddit wants second-precision ISO (YYYY-MM-DDTHH:MM:SSZ), without milliseconds.
const toRedditIso = date => date.toISOString().replace(/\.\d{3}Z$/, "Z");

const resolveDate = (input, now = new Date()) => {
  if (input === undefined || input === null || input === "" || input === "now") {
    return toRedditIso(now);
  }
  const relative = String(input).match(/^([+-])(\d+)([smhdw])$/i);
  if (relative) {
    const sign = relative[1] === "-" ? -1 : 1;
    const unitMs = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };
    const offset = sign * Number(relative[2]) * unitMs[relative[3].toLowerCase()];
    return toRedditIso(new Date(now.getTime() + offset));
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${input} (use ISO, "now", or a relative offset like -7d)`);
  }
  return toRedditIso(date);
};

const LEVEL_FIELD = { campaign: "CAMPAIGN_ID", ad_group: "AD_GROUP_ID", ad: "AD_ID" };

const buildReportBody = (flags, sets) => {
  const level = flags.level || "campaign";
  const levelField = LEVEL_FIELD[level] || LEVEL_FIELD.campaign;
  const fieldsFlag = flags.fields || flags.metrics;
  const fields = fieldsFlag
    ? fieldsFlag.split(",").map(field => field.trim().toUpperCase())
    : [
        levelField,
        "SPEND",
        "IMPRESSIONS",
        "CLICKS",
        "CTR",
        "CPC",
        "KEY_CONVERSION_TOTAL_COUNT"
      ];
  const breakdowns = flags.breakdowns
    ? flags.breakdowns.split(",").map(breakdown => breakdown.trim().toUpperCase())
    : [levelField];
  // Reddit reports require hourly granularity (YYYY-MM-DDTHH:00:00Z).
  const floorHour = iso => iso.replace(/T(\d{2}):\d{2}:\d{2}Z$/, "T$1:00:00Z");
  return {
    starts_at: floorHour(resolveDate(flags.from === undefined ? "-7d" : flags.from)),
    ends_at: floorHour(resolveDate(flags.to === undefined ? "now" : flags.to)),
    fields,
    breakdowns,
    ...(flags["time-zone"] ? { time_zone_id: flags["time-zone"] } : {}),
    ...buildBodyFromSets(sets)
  };
};

const openBrowser = url => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* user can copy the URL manually */
  }
};

const runAuth = async (command, flags) => {
  if (command === "logout") {
    fs.rmSync(auth.sessionPath(), { force: true });
    process.stdout.write("Logged out\n");
    return;
  }
  if (command === "status") {
    const s = auth.readSession();
    if (!s) {
      process.stdout.write("Not logged in\n");
      return;
    }
    process.stdout.write(
      `Logged in. Scope: ${s.scope}. Account: ${s.default_account_id || "(none)"}. Expires: ${new Date(s.expires_at).toISOString()}\n`
    );
    return;
  }
  const { clientId, clientSecret } = resolveCredentials(flags);
  const redirectUri = flags["redirect-uri"] || auth.DEFAULT_REDIRECT_URI;
  const scope = flags.scope || auth.DEFAULT_SCOPE;
  const state = crypto.randomBytes(8).toString("hex");
  const authorizeUrl = auth.buildAuthorizeUrl({ clientId, redirectUri, scope, state });
  let code;
  if (flags.manual) {
    process.stdout.write(
      `Open this URL, authorize, then paste the redirect URL here:\n${authorizeUrl}\n`
    );
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve =>
      rl.question("Paste redirect URL or code: ", resolve)
    );
    rl.close();
    code = auth.parseCodeFromInput(answer, state);
  } else {
    const port = Number(flags.port) || Number(new URL(redirectUri).port) || 8080;
    process.stdout.write(`Opening browser for authorization...\n${authorizeUrl}\n`);
    code = await auth.captureCodeViaLoopback({
      port,
      redirectUri,
      state,
      onUrl: () => openBrowser(authorizeUrl)
    });
  }
  const token = await auth.exchangeCode({ clientId, clientSecret, code, redirectUri });
  auth.writeSession({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
    scope: token.scope,
    redirect_uri: redirectUri,
    // Persisted so later commands can refresh the saved token without re-supplying creds.
    client_id: clientId,
    client_secret: clientSecret
  });
  process.stdout.write(
    "Login successful. Run `reddit-ads-cli accounts list` to find your account id.\n"
  );
};

const runRaw = async (method, rest, flags) => {
  const session = auth.readSession();
  if (!session) {
    throw new Error("Not logged in — run `reddit-ads-cli auth login` first");
  }
  const { clientId, clientSecret } = resolveCredentials(flags, session);
  const { accessToken } = await auth.getValidAccessToken({ session, clientId, clientSecret });
  const api = RedditAdsAPI({ accessToken, baseUrl: flags["base-url"] });
  const body = flags.body ? JSON.parse(flags.body) : undefined;
  const data = await api.request((method || "GET").toUpperCase(), rest[0], { body });
  print(data, flags);
};

const USAGE = {
  auth: {
    desc: "Authenticate and manage the local session",
    cmds: {
      login: "auth login [--manual] [--redirect-uri URL] [--port N] [--scope CSV]",
      status: "auth status",
      logout: "auth logout"
    }
  },
  businesses: {
    desc: "Businesses you can access",
    cmds: { list: "businesses list" }
  },
  accounts: {
    desc: "Ad accounts (use sets the default account)",
    cmds: {
      list: "accounts list",
      show: "accounts show [<ad_account_id>]",
      use: "accounts use <ad_account_id>"
    }
  },
  profiles: {
    desc: "Reddit ad profiles (publishers of creative assets)",
    cmds: { list: "profiles list" }
  },
  campaigns: {
    desc: "Campaigns",
    cmds: {
      list: "campaigns list",
      show: "campaigns show <campaign_id>",
      create: "campaigns create --name N --objective O [--goal N --pixel ID ...]",
      edit: "campaigns edit <campaign_id> [--name N --status S ...]",
      pause: "campaigns pause <campaign_id>",
      resume: "campaigns resume <campaign_id>"
    }
  },
  adgroups: {
    desc: "Ad groups",
    cmds: {
      list: "adgroups list [--campaign <campaign_id>]",
      show: "adgroups show <ad_group_id>",
      create:
        "adgroups create --campaign <id> --name N [--daily-usd 10] [--geo US,GB] [--bid MICROS ...]",
      edit: "adgroups edit <ad_group_id> [flags]",
      pause: "adgroups pause <ad_group_id>",
      resume: "adgroups resume <ad_group_id>"
    }
  },
  ads: {
    desc: "Ads",
    cmds: {
      list: "ads list [--adgroup <ad_group_id>]",
      show: "ads show <ad_id>",
      create:
        "ads create --adgroup <id> --name N --post t3_<id> --click-url <url with utm_source/medium/campaign> --status ACTIVE|PAUSED",
      edit: "ads edit <ad_id> [flags]",
      pause: "ads pause <ad_id>",
      resume: "ads resume <ad_id>"
    }
  },
  creatives: {
    desc: "Creative assets (read-only)",
    cmds: {
      list: "creatives list --profile <profile_id>",
      show: "creatives show <creative_asset_id>"
    }
  },
  posts: {
    desc: "Ad posts (the creative an ad points to)",
    cmds: {
      list: "posts list --profile <profile_id>",
      show: "posts show <post_id>",
      create:
        "posts create --profile <id> --headline H --image <public image url> --url <utm-tagged url> [--cta 'Learn More'] [--display-url d] [--no-comments]"
    }
  },
  reports: {
    desc: "Performance reports",
    cmds: {
      report:
        "reports report [--level campaign|ad_group|ad] [--from -7d] [--to now] [--fields A,B] [--breakdowns X,Y]"
    }
  },
  pixels: {
    desc: "Conversion pixels",
    cmds: { list: "pixels list" }
  },
  events: {
    desc: "Conversion (CAPI) events",
    cmds: {
      send: "events send --pixel <pixel_id> --type PURCHASE [--value N --currency USD --email E]"
    }
  },
  raw: {
    desc: "Call any API endpoint directly",
    cmds: { "<METHOD> <path>": "raw GET /me/businesses [--body '<json>']" }
  }
};

const printGroupHelp = (group, stream = process.stdout) => {
  const usage = USAGE[group];
  if (!usage) {
    return printHelp(stream);
  }
  stream.write(`${group} — ${usage.desc}\n\nCommands:\n`);
  for (const example of Object.values(usage.cmds)) {
    stream.write(`  reddit-ads-cli ${example}\n`);
  }
  stream.write("\nGlobal flags: --account <id>, --json, --client-id, --secret, --base-url\n");
};

const printHelp = (stream = process.stdout) => {
  stream.write("reddit-ads-cli <group> <command> [options]\n\nGroups:\n");
  for (const [group, usage] of Object.entries(USAGE)) {
    stream.write(`  ${group.padEnd(11)} ${usage.desc}\n`);
  }
  stream.write(
    "\nGlobal flags: --account <id>, --json, --client-id, --secret, --base-url\n" +
      "Run `reddit-ads-cli <group>` to see its commands. See README.md for details.\n"
  );
};

const main = async () => {
  const argv = process.argv.slice(2);
  const { _: positionals, flags, sets } = parseArgs(argv);
  const [group, command, ...rest] = positionals;
  if (!group || group === "help") {
    printHelp();
    return;
  }
  if (!USAGE[group]) {
    printHelp(process.stderr);
    throw new Error(`Unknown group: ${group}`);
  }
  if (!command || flags.help) {
    printGroupHelp(group);
    return;
  }
  if (group !== "raw" && !USAGE[group].cmds[command]) {
    printGroupHelp(group, process.stderr);
    throw new Error(`Unknown command: ${group} ${command}`);
  }
  if (group === "auth") {
    await runAuth(command, flags);
    return;
  }
  if (group === "raw") {
    await runRaw(command, rest, flags);
    return;
  }

  const session = auth.readSession();
  if (!session) {
    throw new Error("Not logged in — run `reddit-ads-cli auth login` first");
  }
  const { clientId, clientSecret } = resolveCredentials(flags, session);
  const { accessToken } = await auth.getValidAccessToken({ session, clientId, clientSecret });
  const api = RedditAdsAPI({ accessToken, baseUrl: flags["base-url"] });

  if (group === "accounts" && command === "use") {
    auth.writeSession({ ...session, default_account_id: rest[0] });
    process.stdout.write(`Default account set to ${rest[0]}\n`);
    return;
  }
  if (group === "reports" && command === "report") {
    print(
      await api.reports.run(resolveAccount(flags, session), buildReportBody(flags, sets)),
      flags
    );
    return;
  }
  if (group === "events" && command === "send") {
    if (!flags.pixel) {
      throw new Error("events send requires --pixel <pixel_id>");
    }
    const event = buildConversionEvent({
      type: flags.type,
      customName: flags["custom-name"],
      actionSource: flags["action-source"],
      value: flags.value !== undefined ? Number(flags.value) : undefined,
      currency: flags.currency,
      conversionId: flags["conversion-id"],
      email: flags.email,
      externalId: flags["external-id"],
      clickId: flags["click-id"],
      ip: flags.ip,
      userAgent: flags["user-agent"]
    });
    const payload = { events: [event] };
    if (flags["test-id"]) {
      payload.test_id = flags["test-id"];
    }
    print(await api.events.send(flags.pixel, payload), flags);
    return;
  }

  let cachedAccount;
  const getAccount = () => {
    if (cachedAccount === undefined) {
      cachedAccount = resolveAccount(flags, session);
    }
    return cachedAccount;
  };
  const data = await dispatch({
    group,
    command,
    positionals: rest,
    flags,
    sets,
    api,
    getAccount
  });
  if (!flags.json && group === "creatives") {
    formatCreatives(data);
    return;
  }
  print(data, flags);
};

module.exports = {
  parseArgs,
  setDotPath,
  buildBodyFromSets,
  buildConversionEvent,
  resolveDate,
  buildReportBody,
  formatCreatives,
  resolveCredentials,
  resolveAccount,
  dispatch,
  print,
  main
};

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
