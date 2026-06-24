/**
 * Dashboard shell: app name, taglines, and per-tool accents (nav + cards + tool header).
 */
export const dashboard = {
  appName: "Content Studio",
  /** Shown in sidebar next to logo */
  appNameShort: "Studio",
  tagline:
    "Article discovery, SEO content, and WordPress publishing—each tool with its own workflow.",
  logoLetter: "C",
} as const;

/** Short labels for home cards (in addition to the full tool title from registry). */
export const toolDashboardLabel: Record<string, string> = {
  "article-title-discovery": "Ideas & angles",
  "content-production": "Publish anywhere",
  "weed-com-content-production": "Weed.com editorial",
  "weed-com-strain-comparison": "Strain vs strain",
  "weed-com-strain-page": "Individual strains",
  "weed-com-rank-math": "Rank Math SEO",
};

/** Tokens for sidebar nav rows (active bar, row bg, icon box). */
export type SidebarNavTokens = {
  bar: string;
  rowActive: string;
  rowIdle: string;
  iconActive: string;
  iconIdle: string;
};

export const homeSidebarNav: SidebarNavTokens = {
  bar: "bg-indigo-400",
  rowActive:
    "bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-white/10",
  rowIdle: "text-slate-400 hover:bg-white/[0.06] hover:text-indigo-100",
  iconActive: "bg-indigo-500/40 text-indigo-50 ring-1 ring-indigo-300/25 shadow-inner",
  iconIdle: "bg-white/[0.06] text-slate-500 group-hover:bg-white/10 group-hover:text-indigo-200",
};

export const logsSidebarNav: SidebarNavTokens = {
  bar: "bg-amber-400",
  rowActive:
    "bg-amber-500/[0.2] text-amber-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-amber-400/25",
  rowIdle: "text-slate-400 hover:bg-white/[0.06] hover:text-amber-100",
  iconActive: "bg-amber-500/40 text-amber-50 ring-1 ring-amber-300/25",
  iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-amber-200",
};

type ToolTheme = {
  headerAccent: string;
  cardBlob: string;
  cardBorderHover: string;
  cardTitleHover: string;
  cardCta: string;
  descriptionClass: string;
  sidebarNav: SidebarNavTokens;
};

const defaultTheme: ToolTheme = {
  headerAccent: "border-l-4 border-indigo-400",
  cardBlob: "from-indigo-200 to-violet-100",
  cardBorderHover: "hover:border-indigo-200",
  cardTitleHover: "group-hover:text-indigo-600",
  cardCta: "text-indigo-600",
  descriptionClass: "text-slate-600",
  sidebarNav: {
    bar: "bg-indigo-400",
    rowActive:
      "bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-white/10",
    rowIdle: "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
    iconActive: "bg-indigo-500/40 text-indigo-50 ring-1 ring-indigo-300/25",
    iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-indigo-200",
  },
};

const themes: Record<string, ToolTheme> = {
  "article-title-discovery": {
    headerAccent: "border-l-4 border-violet-500",
    cardBlob: "from-violet-200 to-fuchsia-100",
    cardBorderHover: "hover:border-violet-200",
    cardTitleHover: "group-hover:text-violet-700",
    cardCta: "text-violet-600",
    descriptionClass: "text-violet-950/70",
    sidebarNav: {
      bar: "bg-violet-400",
      rowActive:
        "bg-violet-500/[0.22] text-violet-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-violet-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-violet-200",
      iconActive: "bg-violet-500/45 text-violet-50 ring-1 ring-violet-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-violet-200",
    },
  },
  "content-production": {
    headerAccent: "border-l-4 border-sky-500",
    cardBlob: "from-sky-200 to-cyan-100",
    cardBorderHover: "hover:border-sky-200",
    cardTitleHover: "group-hover:text-sky-700",
    cardCta: "text-sky-600",
    descriptionClass: "text-sky-950/70",
    sidebarNav: {
      bar: "bg-sky-400",
      rowActive:
        "bg-sky-500/[0.22] text-sky-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-sky-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-sky-200",
      iconActive: "bg-sky-500/45 text-sky-50 ring-1 ring-sky-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-sky-200",
    },
  },
  "weed-com-strain-comparison": {
    headerAccent: "border-l-4 border-teal-500",
    cardBlob: "from-teal-200 to-cyan-100",
    cardBorderHover: "hover:border-teal-200",
    cardTitleHover: "group-hover:text-teal-800",
    cardCta: "text-teal-700",
    descriptionClass: "text-teal-950/70",
    sidebarNav: {
      bar: "bg-teal-400",
      rowActive:
        "bg-teal-500/[0.22] text-teal-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-teal-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-teal-200",
      iconActive: "bg-teal-500/45 text-teal-50 ring-1 ring-teal-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-teal-200",
    },
  },
  "weed-com-strain-page": {
    headerAccent: "border-l-4 border-green-500",
    cardBlob: "from-green-200 to-lime-100",
    cardBorderHover: "hover:border-green-200",
    cardTitleHover: "group-hover:text-green-800",
    cardCta: "text-green-700",
    descriptionClass: "text-green-950/70",
    sidebarNav: {
      bar: "bg-green-400",
      rowActive:
        "bg-green-500/[0.22] text-green-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-green-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-green-200",
      iconActive: "bg-green-500/45 text-green-50 ring-1 ring-green-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-green-200",
    },
  },
  "weed-com-rank-math": {
    headerAccent: "border-l-4 border-lime-500",
    cardBlob: "from-lime-200 to-emerald-100",
    cardBorderHover: "hover:border-lime-200",
    cardTitleHover: "group-hover:text-lime-800",
    cardCta: "text-lime-700",
    descriptionClass: "text-lime-950/70",
    sidebarNav: {
      bar: "bg-lime-400",
      rowActive:
        "bg-lime-500/[0.22] text-lime-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-lime-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-lime-200",
      iconActive: "bg-lime-500/45 text-lime-50 ring-1 ring-lime-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-lime-200",
    },
  },
  "weed-com-content-production": {
    headerAccent: "border-l-4 border-emerald-500",
    cardBlob: "from-emerald-200 to-teal-100",
    cardBorderHover: "hover:border-emerald-200",
    cardTitleHover: "group-hover:text-emerald-800",
    cardCta: "text-emerald-600",
    descriptionClass: "text-emerald-950/70",
    sidebarNav: {
      bar: "bg-emerald-400",
      rowActive:
        "bg-emerald-500/[0.22] text-emerald-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-emerald-400/25",
      rowIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-emerald-200",
      iconActive: "bg-emerald-500/45 text-emerald-50 ring-1 ring-emerald-300/30",
      iconIdle: "bg-white/[0.06] text-slate-500 group-hover:text-emerald-200",
    },
  },
};

export function getToolTheme(slug: string): ToolTheme {
  return themes[slug] ?? defaultTheme;
}

export function getSidebarNav(slug: "home" | "logs" | string): SidebarNavTokens {
  if (slug === "home") return homeSidebarNav;
  if (slug === "logs") return logsSidebarNav;
  return getToolTheme(slug).sidebarNav;
}
