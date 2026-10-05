import { articleSlackBotToken } from "@/lib/articleDiscoverySlack";

export type GreenOrgDraftSlackNotice = {
  sent: boolean;
  error?: string;
};

/** Channel for new green.org drafts. Falls back to the article-discovery channel. */
export function greenOrgDraftSlackChannel(): string {
  return (
    process.env.GREENORG_DRAFT_SLACK_CHANNEL?.trim() ||
    process.env.ARTICLE_SLACK_CHANNEL?.trim() ||
    ""
  );
}

function draftSlackWebhookUrl(): string {
  return (
    process.env.GREENORG_DRAFT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.ARTICLE_SLACK_WEBHOOK_URL?.trim() ||
    ""
  );
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function draftMessage(input: {
  title: string;
  editUrl: string;
  postUrl: string;
  categories?: string[];
  excerpt?: string;
}): string {
  const title = input.title.trim() || "Untitled draft";
  const categories = (input.categories ?? []).map((name) => name.trim()).filter(Boolean);
  const lines = ["*New green.org draft*", `*${slackEscape(title)}*`];
  if (categories.length > 0) {
    lines.push(`Categories: ${slackEscape(categories.join(", "))}`);
  }
  if (input.excerpt?.trim()) {
    lines.push(slackEscape(input.excerpt.trim()));
  }
  if (input.editUrl.trim()) {
    lines.push(`<${input.editUrl.trim()}|Open draft in WordPress>`);
  }
  if (input.postUrl.trim() && input.postUrl.trim() !== input.editUrl.trim()) {
    lines.push(`<${input.postUrl.trim()}|Preview>`);
  }
  return lines.join("\n");
}

function slackErrorHint(code: string, channel: string): string {
  if (code === "channel_not_found" || code === "not_in_channel") {
    return ` Slack cannot see channel ${channel}. Invite the bot to that channel (chat:write, or chat:write.public).`;
  }
  if (code === "missing_scope") {
    return " Add bot scopes chat:write and chat:write.public, then reinstall the Slack app.";
  }
  return "";
}

async function postWithBot(token: string, channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!data.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Slack chat.postMessage failed");
  }
}

async function postWithWebhook(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${errText.slice(0, 180)}`);
  }
}

/** Notify Slack that a new green.org WordPress draft was created. Does not throw. */
export async function notifyGreenOrgDraftCreated(input: {
  title: string;
  editUrl: string;
  postUrl: string;
  categories?: string[];
  excerpt?: string;
}): Promise<GreenOrgDraftSlackNotice> {
  const text = draftMessage(input);
  const token = articleSlackBotToken();
  const channel = greenOrgDraftSlackChannel();
  const webhookUrl = draftSlackWebhookUrl();

  if (!token && !webhookUrl) {
    return {
      sent: false,
      error:
        "Set ARTICLE_SLACK_BOT_TOKEN and GREENORG_DRAFT_SLACK_CHANNEL (or ARTICLE_SLACK_CHANNEL) in .env.local.",
    };
  }

  if (token && channel) {
    try {
      await postWithBot(token, channel, text);
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!webhookUrl) {
        return { sent: false, error: `Slack post failed (${msg}).${slackErrorHint(msg, channel)}` };
      }
      try {
        await postWithWebhook(webhookUrl, text);
        return { sent: true };
      } catch (webhookErr) {
        const webhookMsg = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
        return {
          sent: false,
          error: `Slack bot post failed (${msg}).${slackErrorHint(msg, channel)} Webhook also failed: ${webhookMsg}`,
        };
      }
    }
  }

  if (!webhookUrl) {
    return {
      sent: false,
      error: "Set GREENORG_DRAFT_SLACK_CHANNEL (or ARTICLE_SLACK_CHANNEL) to the Slack channel ID.",
    };
  }

  try {
    await postWithWebhook(webhookUrl, text);
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: msg };
  }
}
