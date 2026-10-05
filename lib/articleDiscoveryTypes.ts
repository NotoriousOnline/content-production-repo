import type { GreenOrgCategory } from "@/lib/rssFeeds";
import type { DiscoveryLane } from "@/lib/articleDiscoveryWindows";

export type ArticleDiscoveryPayload = {
  title: string;
  url: string;
  source: string;
  /** ISO-ish or RSS pubDate string when known; empty if unknown. */
  pubDate?: string;
};

export type FetchArticlesResponse = {
  articles: ArticleDiscoveryPayload[];
  source: "rss" | "inoreader" | "inoreader+rss";
  inoreaderError?: string;
};

/** One shortlisted story for human selection (not a final pick). */
export type DiscoveryCandidate = {
  working_title: string;
  category: GreenOrgCategory;
  source_name: string;
  source_url: string;
  also_covered_by: string;
  /** Earliest confirmed break time across sources, or "unconfirmed". */
  broke_at: string;
  /** Hours since break; null if unconfirmed. */
  hours_ago: number | null;
  /** break + 24h, or note when unknown. */
  deadline: string;
  freshness_risk: boolean;
  angle: string;
  distribution_fit: string;
  lane?: DiscoveryLane;
};

/** Ahrefs traffic + search-demand snapshot shown on every shortlisted article. */
export type ArticleDiscoveryAhrefsData = {
  enabled: boolean;
  country: string;
  /** Estimated monthly organic visits for the source URL (often 0 on brand-new news URLs). */
  orgTraffic: number | null;
  orgKeywords: number | null;
  orgKeywordsTop3: number | null;
  /** Highest matching-term monthly search volume for the story topic. */
  topicVolume: number | null;
  seed: string | null;
  terms: { keyword: string; volume: number | null }[];
  error: string | null;
};

/** Slack / UI result shape for the discovery shortlist. */
export type TitleDiscoveryOutputItem = {
  suggested_title: string;
  source_title: string;
  source_url: string;
  source_name: string;
  category?: GreenOrgCategory;
  also_covered_by?: string;
  broke_at?: string;
  hours_ago?: number | null;
  deadline?: string;
  freshness_risk?: boolean;
  angle?: string;
  distribution_fit?: string;
  ahrefs?: ArticleDiscoveryAhrefsData;
  /** fresh = 24h news window; organic = 2–3 week article with Ahrefs traffic. */
  lane?: DiscoveryLane;
};
