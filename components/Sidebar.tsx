"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { tools } from "@/lib/toolRegistry";
import { dashboard, getSidebarNav, toolDashboardLabel } from "@/lib/dashboardBranding";

function IconHome({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function IconNewspaper({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M16.5 7.5l-4.875-3.375a1.125 1.125 0 00-1.5 0L5.25 7.5" />
    </svg>
  );
}

function IconCompose({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function IconLeaf({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.087.065" />
    </svg>
  );
}

function IconLogs({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

const toolIcons: Record<string, ComponentType<{ className?: string }>> = {
  "article-title-discovery": IconNewspaper,
  "content-production": IconCompose,
  "weed-com-content-production": IconLeaf,
  "weed-com-rank-math": IconCompose,
  "weed-com-strain-comparison": IconLeaf,
};

type NavRowProps = {
  href: string;
  active: boolean;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tokens: ReturnType<typeof getSidebarNav>;
  onNavigate: () => void;
};

function NavRow({ href, active, icon, title, subtitle, tokens, onNavigate }: NavRowProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-xl py-2.5 pl-3 pr-3 transition-all duration-200 ${
        active ? tokens.rowActive : tokens.rowIdle
      }`}
    >
      {active ? (
        <span
          className={`absolute left-0 top-1/2 h-9 w-1 -translate-y-1/2 rounded-full ${tokens.bar}`}
          aria-hidden
        />
      ) : null}
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 [&>svg]:h-5 [&>svg]:w-5 ${
          active ? tokens.iconActive : tokens.iconIdle
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold tracking-tight">{title}</span>
        {subtitle ? (
          <span
            className={`mt-0.5 block truncate text-[11px] font-medium leading-snug ${
              active ? "text-white/55" : "text-slate-500 group-hover:text-slate-400"
            }`}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function NavSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{children}</p>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  const isHomeActive = pathname === "/";
  const isLogsActive = pathname === "/logs";
  const isToolActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-900/35 md:hidden"
        aria-label="Open menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] md:hidden" onClick={close} aria-hidden />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-white/[0.07] bg-gradient-to-b from-[#0f1020] via-[#121329] to-[#0c0d18] shadow-2xl shadow-black/40 transition-transform duration-300 ease-out md:relative md:inset-auto md:max-w-none md:translate-x-0 md:shadow-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4 md:px-5">
          <Link href="/" onClick={close} className="group flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-lg shadow-violet-600/25 ring-1 ring-white/10">
              {dashboard.logoLetter}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-base font-bold tracking-tight text-white">{dashboard.appNameShort}</span>
              <span className="block truncate text-xs font-medium text-indigo-300/85">{dashboard.appName}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-8 overflow-y-auto px-3 py-6 md:px-4">
          <div>
            <NavSectionLabel>Overview</NavSectionLabel>
            <div className="space-y-1">
              <NavRow
                href="/"
                active={isHomeActive}
                icon={<IconHome />}
                title="Dashboard"
                subtitle="All tools"
                tokens={getSidebarNav("home")}
                onNavigate={close}
              />
              <NavRow
                href="/logs"
                active={isLogsActive}
                icon={<IconLogs />}
                title="Server logs"
                subtitle="Production errors"
                tokens={getSidebarNav("logs")}
                onNavigate={close}
              />
            </div>
          </div>

          <div>
            <NavSectionLabel>Workflows</NavSectionLabel>
            <div className="space-y-1">
              {tools.map((tool) => {
                const href = `/tools/${tool.slug}`;
                const active = isToolActive(href);
                const Icon = toolIcons[tool.slug] ?? IconCompose;
                const subtitle = toolDashboardLabel[tool.slug];
                return (
                  <NavRow
                    key={tool.slug}
                    href={href}
                    active={active}
                    icon={<Icon />}
                    title={tool.name}
                    subtitle={subtitle}
                    tokens={getSidebarNav(tool.slug)}
                    onNavigate={close}
                  />
                );
              })}
            </div>
          </div>
        </nav>

        <div className="mt-auto border-t border-white/[0.06] px-4 py-4 md:px-5">
          <p className="text-[11px] leading-relaxed text-slate-500">
            API keys and tokens are read on the server only—never exposed to the browser.
          </p>
        </div>
      </aside>
    </>
  );
}
