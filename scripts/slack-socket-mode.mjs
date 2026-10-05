import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusPath = join(root, ".next", "article-slack-socket.json");

function loadEnv() {
  const text = readFileSync(join(root, ".env.local"), "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    process.env[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
}

function writeStatus(partial) {
  try {
    mkdirSync(dirname(statusPath), { recursive: true });
    let prev = {};
    try {
      prev = JSON.parse(readFileSync(statusPath, "utf8"));
    } catch {
      /* first write */
    }
    writeFileSync(statusPath, JSON.stringify({ ...prev, ...partial, pid: process.pid, updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error("[slack-socket] status write failed:", err instanceof Error ? err.message : err);
  }
}

function env(name) {
  return (process.env[name] || "").trim();
}

async function slackApi(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function readSocketData(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (data && typeof data.text === "function") return data.text();
  return String(data);
}

loadEnv();

const appToken = env("SLACK_APP_TOKEN") || env("ARTICLE_SLACK_APP_TOKEN");
const botToken = env("ARTICLE_SLACK_BOT_TOKEN") || env("SLACK_BOT_TOKEN");
const signingSecret = env("SLACK_SIGNING_SECRET") || env("ARTICLE_SLACK_SIGNING_SECRET");
const port = env("PORT") || "3000";

if (!appToken) {
  writeStatus({ configured: false, connected: false, lastError: "SLACK_APP_TOKEN is not set" });
  console.error("[slack-socket] SLACK_APP_TOKEN is not set");
  process.exit(1);
}

writeStatus({ configured: true, connected: false, lastError: null, lastEventAt: null });

const botAuth = await slackApi("auth.test", botToken, {});
const appAuth = await slackApi("auth.test", appToken, {});
const botAppId = typeof botAuth.app_id === "string" ? botAuth.app_id : null;
const tokenAppId = typeof appAuth.app_id === "string" ? appAuth.app_id : null;
console.log(
  `[slack-socket] bot user=${botAuth.user || "?"} team=${botAuth.team_id || "?"} app=${botAppId || "?"}`
);
console.log(
  `[slack-socket] app-token team=${appAuth.team_id || "?"} app=${tokenAppId || appAuth.error || "?"}`
);
if (botAppId && tokenAppId && botAppId !== tokenAppId) {
  const msg = `Bot token and SLACK_APP_TOKEN belong to different Slack apps (${botAppId} vs ${tokenAppId}). Generate the xapp token on the same app as the bot.`;
  writeStatus({ lastError: msg });
  console.error("[slack-socket]", msg);
}

let attempt = 0;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  attempt += 1;
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

async function forwardPayload(payload) {
  const res = await fetch(`http://127.0.0.1:${port}/api/article-title-discovery/slack-socket-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-article-socket-key": signingSecret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`forward ${res.status}: ${text.slice(0, 180)}`);
  }
}

async function onMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn("[slack-socket] non-json frame", String(raw).slice(0, 80));
    return;
  }

  if (msg.type === "hello") {
    attempt = 0;
    writeStatus({ connected: true, lastError: null });
    console.log("[slack-socket] hello — waiting for checkbox ticks");
    return;
  }

  if (msg.type === "disconnect") {
    writeStatus({ connected: false, lastError: `disconnect ${msg.reason || ""}`.trim() });
    try {
      ws.close();
    } catch {
      /* close handler reconnects */
    }
    return;
  }

  if (msg.envelope_id) {
    try {
      ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
    } catch (err) {
      console.error("[slack-socket] ack failed:", err instanceof Error ? err.message : err);
    }
  }

  console.log(`[slack-socket] event type=${msg.type || "unknown"}`);

  if (msg.type !== "interactive" || !msg.payload) return;
  writeStatus({ lastEventAt: new Date().toISOString() });
  try {
    await forwardPayload(msg.payload);
    console.log("[slack-socket] applied shared tick");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeStatus({ lastError: message });
    console.error("[slack-socket] tick update failed:", message);
  }
}

async function connect() {
  writeStatus({ connected: false, lastError: null });
  console.log("[slack-socket] opening connection");
  try {
    const opened = await slackApi("apps.connections.open", appToken, {});
    if (!opened.ok || !opened.url) {
      const err = opened.error || "apps.connections.open failed";
      writeStatus({ lastError: err });
      console.error("[slack-socket]", err);
      scheduleReconnect();
      return;
    }

    const ws = new WebSocket(opened.url);

    ws.addEventListener("open", () => {
      attempt = 0;
      writeStatus({ connected: true, lastError: null });
      console.log("[slack-socket] connected — checkbox ticks will update the channel");
    });

    ws.addEventListener("message", (event) => {
      void readSocketData(event.data).then((text) => onMessage(ws, text));
    });

    ws.addEventListener("close", (event) => {
      writeStatus({ connected: false, lastError: `socket closed (${event.code})` });
      console.warn("[slack-socket] closed", event.code);
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      writeStatus({ lastError: "Slack socket error" });
      console.error("[slack-socket] Slack socket error");
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeStatus({ lastError: message });
    console.error("[slack-socket]", message);
    scheduleReconnect();
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

void connect();
