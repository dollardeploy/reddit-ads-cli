"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

const sessionPath = () => {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "reddit-ads-cli", "session.json");
};

const readSession = (file = sessionPath()) => {
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const writeSession = (session, file = sessionPath()) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const DEFAULT_SCOPE = "adsread adsedit adsconversions";
const DEFAULT_REDIRECT_URI = "http://localhost:8080";
const USER_AGENT = "dollardeploy-reddit-ads-cli/1.0.0";

const buildAuthorizeUrl = ({ clientId, redirectUri, scope, state }) => {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    state,
    redirect_uri: redirectUri,
    duration: "permanent",
    scope
  }).toString();
  return url.toString();
};

const postToken = async ({ clientId, clientSecret, params, fetchImpl }) => {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT
    },
    body: new URLSearchParams(params).toString()
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok || data.error) {
    throw new Error(`Token request failed (${response.status}): ${data.error || raw}`);
  }
  return data;
};

const exchangeCode = ({ clientId, clientSecret, code, redirectUri, fetchImpl = fetch }) =>
  postToken({
    clientId,
    clientSecret,
    fetchImpl,
    params: { grant_type: "authorization_code", code, redirect_uri: redirectUri }
  });

const refreshToken = ({ clientId, clientSecret, refreshToken: token, fetchImpl = fetch }) =>
  postToken({
    clientId,
    clientSecret,
    fetchImpl,
    params: { grant_type: "refresh_token", refresh_token: token }
  });

const getValidAccessToken = async ({
  session,
  clientId,
  clientSecret,
  now = Date.now(),
  fetchImpl = fetch
}) => {
  if (session.access_token && session.expires_at && session.expires_at - now > 60_000) {
    return { accessToken: session.access_token, session };
  }
  const data = await refreshToken({
    clientId,
    clientSecret,
    refreshToken: session.refresh_token,
    fetchImpl
  });
  const updated = {
    ...session,
    access_token: data.access_token,
    expires_at: now + data.expires_in * 1000,
    scope: data.scope || session.scope,
    refresh_token: data.refresh_token || session.refresh_token
  };
  writeSession(updated, session._file || sessionPath());
  return { accessToken: data.access_token, session: updated };
};

const hashPII = value =>
  crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");

const parseCodeFromInput = (input, expectedState) => {
  const trimmed = input.trim();
  if (!trimmed.includes("?") && !trimmed.includes("=") && !trimmed.startsWith("http")) {
    return trimmed;
  }
  const url = new URL(trimmed);
  if (url.searchParams.get("error")) {
    throw new Error(`Authorization failed: ${url.searchParams.get("error")}`);
  }
  if (expectedState && url.searchParams.get("state") !== expectedState) {
    throw new Error("OAuth state mismatch — aborting for safety");
  }
  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("No code found in the pasted redirect URL");
  }
  return code;
};

const captureCodeViaLoopback = ({ port, redirectUri, state, onUrl }) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      res.writeHead(error ? 400 : 200, { "content-type": "text/html" });
      res.end(
        `<html><body><h2>${error ? "Authorization failed" : "Reddit Ads CLI authorized"}</h2>You can close this tab.</body></html>`
      );
      if (error) {
        server.close();
        return reject(new Error(`Authorization failed: ${error}`));
      }
      if (!code) {
        return;
      } // ignore favicon / unrelated hits
      if (state && gotState !== state) {
        server.close();
        return reject(new Error("OAuth state mismatch — aborting for safety"));
      }
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(port, () => {
      if (onUrl) {
        onUrl();
      }
    });
  });

module.exports = {
  sessionPath,
  readSession,
  writeSession,
  hashPII,
  parseCodeFromInput,
  captureCodeViaLoopback,
  TOKEN_URL,
  AUTHORIZE_URL,
  DEFAULT_SCOPE,
  DEFAULT_REDIRECT_URI,
  USER_AGENT,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  getValidAccessToken
};
