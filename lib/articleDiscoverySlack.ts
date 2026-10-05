import { createHmac, timingSafeEqual } from "crypto";
import type { TitleDiscoveryOutputItem } from "@/lib/articleDiscoveryTypes";

export const SLACK_INTERACT_PATH = "/api/article-title-discovery/slack-interact";
const METADATA_EVENT = "green_org_article_picks";

type SlackBlock = Record<string, unknown>;

type SlackCheckboxOption = {
  text: { type: string; text: string; emoji?: boolean };
  value: string;
};

export type SlackInteractionPayload = {
  type?: string;
  user?: { id?: string; username?: string; name?: string };
  channel?: { id?: string };
  message?: {
    ts?: string;
    text?: string;
    blocks?: SlackBlock[];
    metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
  };
  response_url?: string;
  actions?: Array<{
    type?: string;
    action_id?: string;
    block_id?: string;
    selected_options?: SlackCheckboxOption[];
  }>;
};

export function articleSlackBotToken(): string {
  return (
    process.env.ARTICLE_SLACK_BOT_TOKEN?.trim() ||
    process.env.SLACK_BOT_TOKEN?.trim() ||
    ""
  );
}

export function articleSlackChannel(): string {
  return process.env.ARTICLE_SLACK_CHANNEL?.trim() || "";
}

export function articleSlackSigningSecret(): string {
  return (
    process.env.ARTICLE_SLACK_SIGNING_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim() ||
    ""
  );
}

export function articleSlackAppToken(): string {
  return (
    process.env.SLACK_APP_TOKEN?.trim() ||
    process.env.ARTICLE_SLACK_APP_TOKEN?.trim() ||
    ""
  );
}

export function isSlackInteractiveConfigured(): boolean {
  return Boolean(articleSlackBotToken() && articleSlackChannel() && articleSlackSigningSecret());
}

export type SlackSetupStatus = {
  keysSet: boolean;
  botOk: boolean;
  botName: string | null;
  channel: string | null;
  canPost: boolean | null;
  error: string | null;
  nextStep: string | null;
  interactPath: string;
  socketConfigured: boolean;
  socketConnected: boolean;
  ticksReady: boolean;
};

export function attachSocketStatus(
  setup: SlackSetupStatus,
  socket: { configured: boolean; connected: boolean; lastError: string | null }
): SlackSetupStatus {
  const socketConfigured = socket.configured;
  const socketConnected = socket.connected;
  const ticksReady = Boolean(setup.botOk && setup.channel && socketConnected);
  let nextStep = setup.nextStep;
  if (setup.botOk && !socketConfigured) {
    nextStep =
      "Slack cannot reach localhost, so ticks show a warning and stay private. In the Slack app: enable Socket Mode, create an App-Level Token with connections:write, add SLACK_APP_TOKEN (starts with xapp-) to .env.local, then restart npm run dev.";
  } else if (setup.botOk && socketConfigured && !socketConnected) {
    nextStep = socket.lastError
      ? `Socket Mode is not connected: ${socket.lastError}. Enable Socket Mode and Interactivity & Shortcuts on the same Slack app as the bot.`
      : "Connecting to Slack Socket Mode… keep this page open, then tick Select again.";
  } else if (ticksReady) {
    nextStep = socket.lastError
      ? socket.lastError
      : "Shared ticks are live. Tick Select on a new Slack checklist — the whole channel will see it.";
  }
  return { ...setup, socketConfigured, socketConnected, ticksReady, nextStep };
}

export async function diagnoseSlackSetup(): Promise<SlackSetupStatus> {
  const token = articleSlackBotToken();
  const channel = articleSlackChannel();
  const secret = articleSlackSigningSecret();
  const keysSet = Boolean(token && channel && secret);
  const base: SlackSetupStatus = {
    keysSet,
    botOk: false,
    botName: null,
    channel: channel || null,
    canPost: null,
    error: null,
    nextStep: keysSet
      ? null
      : "Set ARTICLE_SLACK_BOT_TOKEN, ARTICLE_SLACK_CHANNEL, and SLACK_SIGNING_SECRET in .env.local, then restart npm run dev.",
    interactPath: SLACK_INTERACT_PATH,
    socketConfigured: Boolean(articleSlackAppToken()),
    socketConnected: false,
    ticksReady: false,
  };
  if (!token) return base;

  try {
    const auth = await slackApi("auth.test", token, {});
    const botName = typeof auth.user === "string" ? auth.user : null;
    if (!channel) {
      return {
        ...base,
        botOk: true,
        botName,
        error: "ARTICLE_SLACK_CHANNEL is empty",
        nextStep: "Set ARTICLE_SLACK_CHANNEL to the channel ID (starts with C).",
      };
    }
    return {
      ...base,
      botOk: true,
      botName,
      nextStep: botName
        ? `Bot @${botName} can post. Shared ticks still need Socket Mode on localhost.`
        : "Bot can post. Shared ticks still need Socket Mode on localhost.",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      error: msg,
      nextStep: "The bot token was rejected. Generate a new Bot User OAuth Token after installing the app.",
    };
  }
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-US");
}

function trafficLabel(r: TitleDiscoveryOutputItem): string {
  const visits = r.ahrefs?.orgTraffic;
  const volume = r.ahrefs?.topicVolume;
  if (visits != null && visits > 0) return `${formatCompact(visits)} org visits/mo`;
  if (volume != null && volume > 0) return `${formatCompact(volume)} topic vol/mo`;
  return "traffic n/a";
}

function laneLabel(r: TitleDiscoveryOutputItem): string {
  return r.lane === "organic" ? "2–3w" : "24h";
}

function splitByLane(results: TitleDiscoveryOutputItem[]): {
  fresh: TitleDiscoveryOutputItem[];
  organic: TitleDiscoveryOutputItem[];
} {
  return {
    fresh: results.filter((r) => r.lane !== "organic"),
    organic: results.filter((r) => r.lane === "organic"),
  };
}

function escapeSlackLinkText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function selectOption(index: number): SlackCheckboxOption {
  return {
    text: { type: "plain_text", text: "Select", emoji: true },
    value: `a${index}`,
  };
}

function checkboxRow(
  r: TitleDiscoveryOutputItem,
  index: number,
  pickerUserId?: string
): SlackBlock {
  const title = escapeSlackLinkText(r.suggested_title.replace(/\s+/g, " ").trim());
  const meta = `${r.source_name || "Source"} · ${laneLabel(r)} · ${trafficLabel(r)}`;
  const option = selectOption(index);
  const selected = Boolean(pickerUserId);
  let text = `*<${r.source_url}|${title}>*\n${escapeSlackLinkText(meta)}`;
  if (pickerUserId) text += `\n:white_check_mark: selected by <@${pickerUserId}>`;
  return {
    type: "section",
    block_id: `article_${index}`,
    text: { type: "mrkdwn", text },
    accessory: {
      type: "checkboxes",
      action_id: `select_${index}`,
      options: [option],
      ...(selected ? { initial_options: [option] } : {}),
    },
  };
}

function groupBlocks(heading: string, items: TitleDiscoveryOutputItem[], offset: number): SlackBlock[] {
  if (items.length === 0) return [];
  return [
    { type: "section", text: { type: "mrkdwn", text: heading } },
    ...items.map((item, i) => checkboxRow(item, offset + i)),
  ];
}

function picksSummaryBlock(blocks: SlackBlock[]): SlackBlock {
  const picks: string[] = [];
  for (const block of blocks) {
    if (typeof block.block_id !== "string" || !block.block_id.startsWith("article_")) continue;
    const accessory = block.accessory as { initial_options?: unknown[] } | undefined;
    const selected = Array.isArray(accessory?.initial_options) && accessory.initial_options.length > 0;
    if (!selected) continue;
    const text = (block.text as { text?: string } | undefined)?.text ?? "";
    const link = text.match(/\*<([^>|]+)\|([^>]+)>\*/);
    const who = text.match(/selected by (<@[^>]+>)/);
    const title = link?.[2] ?? "Article";
    const url = link?.[1];
    const label = url ? `<${url}|${title}>` : title;
    picks.push(`• ${label}${who?.[1] ? ` — ${who[1]}` : ""}`);
  }
  const body =
    picks.length > 0
      ? `*Live picks (${picks.length}) — visible to everyone in this channel*\n${picks.join("\n")}`
      : "_No picks yet. Tick *Select* — the whole channel will see it._";
  return {
    type: "section",
    block_id: "picks_summary",
    text: { type: "mrkdwn", text: body },
  };
}

export function buildSlackBlocks(results: TitleDiscoveryOutputItem[]): SlackBlock[] {
  const { fresh, organic } = splitByLane(results);
  const articleBlocks = [
    ...groupBlocks("*24h news*", fresh, 0),
    ...(organic.length > 0 && fresh.length > 0 ? [{ type: "divider" }] : []),
    ...groupBlocks("*2–3 weeks · Ahrefs organic traffic*", organic, fresh.length),
  ];
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "green.org — select articles", emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${formatDate()} · ticks are shared live · everyone in this channel can see who picked what`,
        },
      ],
    },
    picksSummaryBlock([]),
    ...articleBlocks,
  ];
}

export function buildTextChecklist(results: TitleDiscoveryOutputItem[]): string {
  const { fresh, organic } = splitByLane(results);
  const lines: string[] = [
    "*green.org — select articles*",
    formatDate(),
    "_Tick Select next to a story. Picks are shared with the whole channel._",
    "",
  ];
  const pushGroup = (label: string, items: TitleDiscoveryOutputItem[]) => {
    if (items.length === 0) return;
    lines.push(`*${label}*`);
    for (const r of items) {
      lines.push(`☐ <${r.source_url}|${r.suggested_title}>`);
      lines.push(`    ${r.source_name || "Source"} · ${laneLabel(r)} · ${trafficLabel(r)}`);
    }
    lines.push("");
  };
  pushGroup("24h news", fresh);
  pushGroup("2–3 weeks · organic traffic", organic);
  return lines.join("\n").trim();
}

export function applySharedCheckbox(
  blocks: SlackBlock[],
  payload: SlackInteractionPayload
): SlackBlock[] {
  const action = payload.actions?.find((a) => a.type === "checkboxes") ?? payload.actions?.[0];
  if (!action?.block_id) return blocks;
  const userId = payload.user?.id;
  const selected = Array.isArray(action.selected_options) ? action.selected_options : [];
  const checked = selected.length > 0;

  const next = blocks.map((block) => {
    if (block.block_id !== action.block_id) return block;
    const accessory = { ...((block.accessory as Record<string, unknown> | undefined) ?? {}) };
    if (checked) accessory.initial_options = selected;
    else delete accessory.initial_options;
    const textObj = (block.text as { type?: string; text?: string } | undefined) ?? {};
    const current = typeof textObj.text === "string" ? textObj.text : "";
    const stripped = current
      .split("\n")
      .filter((line) => !line.includes("selected by"))
      .join("\n");
    const text = checked && userId ? `${stripped}\n:white_check_mark: selected by <@${userId}>` : stripped;
    return {
      ...block,
      accessory,
      text: { type: "mrkdwn", text },
    };
  });

  const withoutSummary = next.filter((b) => b.block_id !== "picks_summary");
  const insertAt = withoutSummary[0]?.type === "header" ? 2 : 0;
  const summary = picksSummaryBlock(withoutSummary);
  const start = withoutSummary.slice(0, insertAt);
  const rest = withoutSummary.slice(insertAt);
  return [...start, summary, ...rest];
}

export function verifySlackRequestSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || !opts.signature || !opts.rawBody) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${opts.timestamp}:${opts.rawBody}`;
  const digest = `v0=${createHmac("sha256", opts.signingSecret).update(base).digest("hex")}`;
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(opts.signature.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function slackApi(method: string, token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    const err = typeof data.error === "string" ? data.error : `Slack ${method} failed`;
    throw new Error(err);
  }
  return data;
}

export async function postDiscoveryChecklist(results: TitleDiscoveryOutputItem[]): Promise<{
  ok: true;
  count: number;
  interactive: boolean;
  warning?: string;
} | { ok: false; error: string }> {
  const items = results.slice(0, 24);
  if (items.length === 0) return { ok: true, count: 0, interactive: false };

  const text = buildTextChecklist(items);
  const blocks = buildSlackBlocks(items);
  const webhookUrl = process.env.ARTICLE_SLACK_WEBHOOK_URL?.trim();
  const botToken = articleSlackBotToken();
  const channel = articleSlackChannel();
  const interactive = isSlackInteractiveConfigured();

  if (botToken && channel) {
    try {
      await slackApi("chat.postMessage", botToken, {
        channel,
        text,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
        metadata: {
          event_type: METADATA_EVENT,
          event_payload: { count: items.length },
        },
      });
      return {
        ok: true,
        count: items.length,
        interactive,
        ...(interactive
          ? {}
          : {
              warning:
                "Posted with the bot, but SLACK_SIGNING_SECRET is missing — ticks will not save for the rest of the channel until you add it and set the Interactivity Request URL.",
            }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        msg === "channel_not_found" || msg === "not_in_channel"
          ? ` Slack cannot see channel ${channel}. Open that channel and run /invite @article_title_discove (or add chat:write.public and reinstall the app).`
          : msg === "missing_scope"
            ? " Add bot scopes chat:write and chat:write.public, reinstall the app, then try again."
            : "";
      if (!webhookUrl) {
        return { ok: false, error: `Slack bot post failed (${msg}).${hint}` };
      }
      const posted = await postWebhook(webhookUrl, text, blocks);
      if (!posted.ok) return posted;
      return {
        ok: true,
        count: items.length,
        interactive: false,
        warning: `Bot post failed (${msg}). Sent via webhook instead — ticks will not stay shared until the bot can post.`,
      };
    }
  }

  if (!webhookUrl) {
    return {
      ok: false,
      error:
        "Set ARTICLE_SLACK_WEBHOOK_URL (Incoming Webhook for the target channel). Bot posting is off unless ARTICLE_SLACK_USE_BOT=true.",
    };
  }

  const posted = await postWebhook(webhookUrl, text, blocks);
  if (!posted.ok) return posted;
  return {
    ok: true,
    count: items.length,
    interactive: false,
    warning:
      "Posted via webhook. Checkboxes are not shared live. Add ARTICLE_SLACK_BOT_TOKEN, ARTICLE_SLACK_CHANNEL, SLACK_SIGNING_SECRET, and point Slack Interactivity at /api/article-title-discovery/slack-interact.",
  };
}

async function postWebhook(
  webhookUrl: string,
  text: string,
  blocks: SlackBlock[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn("[discovery-slack] Block Kit rejected, retrying text:", res.status, errText.slice(0, 240));
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const retryText = await res.text();
      return { ok: false, error: `Slack webhook failed: ${res.status} ${retryText.slice(0, 180)}` };
    }
  }
  return { ok: true };
}

export async function postSlackConnectionTest(): Promise<
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string }
> {
  const botToken = articleSlackBotToken();
  const channel = articleSlackChannel();
  if (!botToken || !channel) {
    return { ok: false, error: "Bot token or channel is missing" };
  }

  const items: TitleDiscoveryOutputItem[] = [
    {
      suggested_title: "Shared tick test A — check this box",
      source_title: "Shared tick test A",
      source_url: "https://green.org",
      source_name: "Setup",
      lane: "fresh",
    },
    {
      suggested_title: "Shared tick test B — another person should see your tick",
      source_title: "Shared tick test B",
      source_url: "https://green.org",
      source_name: "Setup",
      lane: "organic",
    },
  ];

  try {
    const data = await slackApi("chat.postMessage", botToken, {
      channel,
      text: buildTextChecklist(items),
      blocks: buildSlackBlocks(items),
      unfurl_links: false,
      unfurl_media: false,
    });
    const ts = typeof data.ts === "string" ? data.ts : "";
    const postedChannel = typeof data.channel === "string" ? data.channel : channel;
    return { ok: true, ts, channel: postedChannel };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "channel_not_found" || msg === "not_in_channel") {
      return {
        ok: false,
        error: `Bot cannot post to ${channel}. In that Slack channel run: /invite @article_title_discove`,
      };
    }
    return { ok: false, error: `Slack test post failed (${msg})` };
  }
}

export async function handleDiscoverySlackInteraction(payload: SlackInteractionPayload): Promise<{
  text: string;
  blocks: SlackBlock[];
}> {
  const currentBlocks = Array.isArray(payload.message?.blocks) ? payload.message.blocks : [];
  const blocks = applySharedCheckbox(currentBlocks, payload);
  await publishUpdatedChecklist(payload, blocks);
  const text =
    typeof payload.message?.text === "string"
      ? payload.message.text
      : "green.org — select articles";
  return { text, blocks };
}

export async function publishUpdatedChecklist(payload: SlackInteractionPayload, blocks: SlackBlock[]): Promise<void> {
  const text =
    typeof payload.message?.text === "string"
      ? payload.message.text
      : "green.org — select articles";
  const botToken = articleSlackBotToken();
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;

  if (botToken && channel && ts) {
    await slackApi("chat.update", botToken, {
      channel,
      ts,
      text,
      blocks,
    });
    return;
  }

  if (!payload.response_url) {
    throw new Error("No Slack response_url or bot token to update the message");
  }
  const res = await fetch(payload.response_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks }),
  });
  if (!res.ok) {
    throw new Error(`Slack response_url failed: ${res.status}`);
  }
}
