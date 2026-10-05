/** Fresh Google News lane: still publishable inside ~24h of break. */
export const FRESH_MAX_HOURS = 22;

/** Older stories must be at least ~2 days old so they can have indexed organic traffic. */
export const ORGANIC_MIN_HOURS = 48;

/** Upper bound for the traffic lane (3 weeks). */
export const ORGANIC_MAX_HOURS = 21 * 24;

export const MAX_POOL_AGE_MS = ORGANIC_MAX_HOURS * 60 * 60 * 1000;

/** Any positive Ahrefs organic-visit estimate qualifies an older URL. */
export const MIN_ORG_TRAFFIC = 1;

export type DiscoveryLane = "fresh" | "organic";

export function hoursFromPubDate(pubDate: string | undefined, nowMs = Date.now()): number | null {
  if (!pubDate?.trim()) return null;
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / (1000 * 60 * 60);
}

export function laneFromHours(hoursAgo: number | null): DiscoveryLane | null {
  if (hoursAgo == null) return null;
  if (hoursAgo < FRESH_MAX_HOURS) return "fresh";
  if (hoursAgo >= ORGANIC_MIN_HOURS && hoursAgo <= ORGANIC_MAX_HOURS) return "organic";
  return null;
}
