/**
 * Green.org Daily News Discovery — fixed six sources only.
 * Do not add outlets outside this list.
 */
export type GreenOrgDiscoverySource = {
  name: string;
  /** Primary RSS/Atom feed when available. */
  feedUrl: string | null;
  /** Optional HTML fallback page if the feed fails or is empty. */
  htmlUrl?: string;
  /** Optional Google News RSS query when the outlet blocks direct feeds. */
  googleNewsQuery?: string;
  /** Host substrings used to accept Inoreader items from this outlet. */
  hostMatchers: string[];
};

export const GREEN_ORG_DISCOVERY_SOURCES: GreenOrgDiscoverySource[] = [
  {
    name: "ENN",
    feedUrl: "https://www.enn.com/rss",
    htmlUrl: "https://www.enn.com/",
    hostMatchers: ["enn.com"],
  },
  {
    name: "Bloomberg Green",
    feedUrl: "https://feeds.bloomberg.com/green.rss",
    htmlUrl: "https://www.bloomberg.com/green",
    /** When native feed is blocked, query Google News for Bloomberg Green coverage. */
    googleNewsQuery: "source:Bloomberg (green OR climate OR renewable OR solar OR EV) when:2d",
    hostMatchers: ["bloomberg.com"],
  },
  {
    name: "Reuters Environment",
    feedUrl: "https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best&best-topics=environment",
    htmlUrl: "https://www.reuters.com/business/environment/",
    googleNewsQuery: "source:Reuters (environment OR climate OR renewable OR \"clean energy\") when:2d",
    hostMatchers: ["reuters.com", "reutersagency.com"],
  },
  {
    name: "Carbon Brief",
    feedUrl: "https://www.carbonbrief.org/feed/",
    hostMatchers: ["carbonbrief.org"],
  },
  {
    name: "Canary Media",
    feedUrl: "https://www.canarymedia.com/feed",
    hostMatchers: ["canarymedia.com"],
  },
  {
    name: "The Guardian Environment",
    feedUrl: "https://www.theguardian.com/environment/rss",
    hostMatchers: ["theguardian.com"],
  },
];

/** @deprecated Use GREEN_ORG_DISCOVERY_SOURCES — kept for older imports. */
export const RSS_FEEDS = GREEN_ORG_DISCOVERY_SOURCES.filter((s) => s.feedUrl).map((s) => ({
  name: s.name,
  url: s.feedUrl as string,
}));

/** @deprecated HTML scrapers for non-list outlets removed; six-source feeds only. */
export const HTML_DISCOVERY_SOURCES: Array<{
  name: string;
  url: string;
  parser?: "enn";
}> = GREEN_ORG_DISCOVERY_SOURCES.filter((s) => s.htmlUrl).map((s) => ({
  name: s.name,
  url: s.htmlUrl as string,
  ...(s.name === "ENN" ? { parser: "enn" as const } : {}),
}));

export const GREEN_ORG_CATEGORIES = ["Energy", "Tech", "Climate", "Transportation"] as const;
export type GreenOrgCategory = (typeof GREEN_ORG_CATEGORIES)[number];
