"use strict";

const DEFAULT_BASE_URL = "https://ads-api.reddit.com/api/v3";
const USER_AGENT = "dollardeploy-reddit-ads-cli/1.0.0";

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const buildQuery = (query = {}) => {
  const parts = Object.keys(query)
    .filter(k => query[k] !== undefined && query[k] !== null && query[k] !== "")
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

function RedditAdsAPI(options = {}) {
  const accessToken = options.accessToken;
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || defaultSleep;
  const maxRetries = options.maxRetries ?? 3;

  if (!accessToken) {
    throw new Error("RedditAdsAPI: accessToken is required");
  }

  const request = async (method, path, { query, body } = {}) => {
    const url = `${baseUrl}${path}${buildQuery(query)}`;
    const headers = {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT
    };
    const fetchOptions = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, fetchOptions);
      if (response.status === 429 && attempt < maxRetries) {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 2 ** attempt * 500;
        await sleepImpl(waitMs);
        continue;
      }
      const raw = await response.text();
      let data;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
      }
      if (!response.ok) {
        const message =
          (data && (data.error || data.message || data.explanation)) ||
          `Request failed with status ${response.status}`;
        const error = new Error(
          typeof message === "string" ? message : JSON.stringify(message)
        );
        error.status = response.status;
        error.response = { status: response.status, data };
        throw error;
      }
      return data;
    }
  };

  const acct = id => `/ad_accounts/${encodeURIComponent(id)}`;
  const enc = id => encodeURIComponent(id);
  // The Reddit Ads API wraps request bodies (and responses) in a `data` envelope.
  const wrap = body => (body === undefined ? undefined : { data: body });

  // Collections are account-scoped for list/create; individual entities are
  // addressed by their own top-level path (e.g. /campaigns/{id}) for get/update.
  const entity = (collection, singular) => ({
    list: (accountId, query) => request("GET", `${acct(accountId)}/${collection}`, { query }),
    create: (accountId, body) =>
      request("POST", `${acct(accountId)}/${collection}`, { body: wrap(body) }),
    get: id => request("GET", `/${singular}/${enc(id)}`),
    update: (id, body) => request("PATCH", `/${singular}/${enc(id)}`, { body: wrap(body) })
  });

  return {
    request,
    me: () => request("GET", "/me"),
    businesses: () => request("GET", "/me/businesses"),
    businessAdAccounts: businessId =>
      request("GET", `/businesses/${enc(businessId)}/ad_accounts`),
    businessProfiles: businessId => request("GET", `/businesses/${enc(businessId)}/profiles`),
    accounts: {
      get: id => request("GET", `/ad_accounts/${enc(id)}`),
      update: (id, body) => request("PATCH", `/ad_accounts/${enc(id)}`, { body: wrap(body) })
    },
    campaigns: entity("campaigns", "campaigns"),
    adGroups: entity("ad_groups", "ad_groups"),
    ads: entity("ads", "ads"),
    pixels: {
      list: accountId => request("GET", `${acct(accountId)}/pixels`)
    },
    reports: {
      run: (accountId, body) =>
        request("POST", `${acct(accountId)}/reports`, { body: wrap(body) })
    },
    creativeAssets: {
      list: profileId => request("GET", `/profiles/${enc(profileId)}/creative_assets`),
      get: id => request("GET", `/creative_assets/${enc(id)}`)
    },
    events: {
      send: (pixelId, body) =>
        request("POST", `/pixels/${enc(pixelId)}/conversion_events`, { body: wrap(body) })
    }
  };
}

module.exports = RedditAdsAPI;
