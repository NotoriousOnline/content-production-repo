import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { articleSlackAppToken } from "@/lib/articleDiscoverySlack";

export type SlackSocketStatus = {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  lastError: string | null;
  lastEventAt: string | null;
};

type StatusFile = {
  configured?: boolean;
  connected?: boolean;
  lastError?: string | null;
  lastEventAt?: string | null;
  pid?: number;
  updatedAt?: string;
};

const statusPath = join(process.cwd(), ".next", "article-slack-socket.json");
const scriptPath = join(process.cwd(), "scripts", "slack-socket-mode.mjs");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readStatusFile(): StatusFile | null {
  try {
    return JSON.parse(readFileSync(statusPath, "utf8")) as StatusFile;
  } catch {
    return null;
  }
}

export function getSlackSocketStatus(): SlackSocketStatus {
  const configured = Boolean(articleSlackAppToken());
  const file = readStatusFile();
  const pid = typeof file?.pid === "number" ? file.pid : 0;
  const running = pid > 0 && isAlive(pid);
  return {
    configured,
    connected: Boolean(running && file?.connected),
    connecting: Boolean(running && !file?.connected),
    lastError: file?.lastError ?? (configured ? null : "SLACK_APP_TOKEN is not set"),
    lastEventAt: file?.lastEventAt ?? null,
  };
}

function stopLegacyInProcessSocket(): void {
  const g = globalThis as typeof globalThis & {
    __articleSlackSocket?: {
      ws?: { close(): void } | null;
      reconnectTimer?: ReturnType<typeof setTimeout> | null;
      started?: boolean;
      status?: { connected?: boolean; connecting?: boolean };
    };
  };
  const legacy = g.__articleSlackSocket;
  if (!legacy) return;
  if (legacy.reconnectTimer) {
    clearTimeout(legacy.reconnectTimer);
    legacy.reconnectTimer = null;
  }
  try {
    legacy.ws?.close();
  } catch {
    /* ignore */
  }
  legacy.ws = null;
  legacy.started = false;
  if (legacy.status) {
    legacy.status.connected = false;
    legacy.status.connecting = false;
  }
  g.__articleSlackSocket = undefined;
}

export function startSlackSocketMode(): SlackSocketStatus {
  stopLegacyInProcessSocket();
  const token = articleSlackAppToken();
  if (!token) {
    return getSlackSocketStatus();
  }

  const g = globalThis as typeof globalThis & { __articleSlackChildPid?: number };
  const file = readStatusFile();
  const existingPid = g.__articleSlackChildPid || file?.pid;
  if (existingPid && isAlive(existingPid)) {
    g.__articleSlackChildPid = existingPid;
    return getSlackSocketStatus();
  }

  if (!existsSync(scriptPath)) {
    return {
      ...getSlackSocketStatus(),
      lastError: "scripts/slack-socket-mode.mjs is missing",
    };
  }

  const child = spawn(process.execPath, ["--use-system-ca", scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
  g.__articleSlackChildPid = child.pid;
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("exit", (code) => {
    if (g.__articleSlackChildPid === child.pid) {
      g.__articleSlackChildPid = undefined;
    }
    console.error("[slack-socket] worker exited", code);
  });
  child.unref();

  return getSlackSocketStatus();
}
