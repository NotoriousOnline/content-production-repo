export const RSS_FEEDS = [
  { name: "ENN", url: "https://www.enn.com/rss" },
  { name: "ENN Climate", url: "https://www.enn.com/climate/feed" },
  { name: "ENN Energy", url: "https://www.enn.com/energy/feed" },
  { name: "ENN Pollution", url: "https://www.enn.com/pollution/feed" },
  { name: "Treehugger", url: "https://www.treehugger.com/feeds/all" },
  { name: "The Guardian Environment", url: "https://www.theguardian.com/environment/rss" },
  { name: "Earth Day", url: "https://www.earthday.org/feed/" },
  { name: "Yale E360", url: "https://e360.yale.edu/feed" },
];

/** Non-RSS section pages we scrape for latest headlines. */
export const HTML_DISCOVERY_SOURCES = [
  { name: "ENN Climate", url: "https://www.enn.com/climate", parser: "enn" as const },
  { name: "ENN Energy", url: "https://www.enn.com/energy", parser: "enn" as const },
  { name: "ENN Pollution", url: "https://www.enn.com/pollution", parser: "enn" as const },
  { name: "ENN Ecosystems", url: "https://www.enn.com/ecosystems", parser: "enn" as const },
  { name: "ENN Wildlife", url: "https://www.enn.com/wildlife", parser: "enn" as const },
  { name: "ENN Policy", url: "https://www.enn.com/environmental-policy", parser: "enn" as const },
  { name: "CNN Climate", url: "https://www.cnn.com/climate" },
  { name: "CNN Energy", url: "https://www.cnn.com/business/energy" },
];
