import type { ComponentType } from "react";
import { config as articleTitleDiscoveryConfig } from "@/tools/article-title-discovery/config";
import ArticleTitleDiscoveryTool from "@/tools/article-title-discovery/index";
import { config as contentProductionConfig } from "@/tools/content-production/config";
import ContentProductionTool from "@/tools/content-production/index";
import { config as socialAutomationConfig } from "@/tools/social-automation/config";
import SocialAutomationTool from "@/tools/social-automation/index";
import { config as weedComContentProductionConfig } from "@/tools/weed-com-content-production/config";
import WeedComContentProductionTool from "@/tools/weed-com-content-production/index";

export type ToolConfig = {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
};

export const tools: ToolConfig[] = [
  {
    slug: articleTitleDiscoveryConfig.slug,
    name: articleTitleDiscoveryConfig.name,
    description: articleTitleDiscoveryConfig.description,
    icon: articleTitleDiscoveryConfig.icon,
  },
  {
    slug: contentProductionConfig.slug,
    name: contentProductionConfig.name,
    description: contentProductionConfig.description,
    icon: contentProductionConfig.icon,
  },
  {
    slug: weedComContentProductionConfig.slug,
    name: weedComContentProductionConfig.name,
    description: weedComContentProductionConfig.description,
    icon: weedComContentProductionConfig.icon,
  },
  {
    slug: socialAutomationConfig.slug,
    name: socialAutomationConfig.name,
    description: socialAutomationConfig.description,
    icon: socialAutomationConfig.icon,
  },
];

const componentMap: Record<string, ComponentType> = {
  "article-title-discovery": ArticleTitleDiscoveryTool,
  "content-production": ContentProductionTool,
  "weed-com-content-production": WeedComContentProductionTool,
  "social-automation": SocialAutomationTool,
};

export function getToolConfig(slug: string): ToolConfig | undefined {
  return tools.find((t) => t.slug === slug);
}

export function getToolComponent(slug: string): ComponentType | undefined {
  return componentMap[slug];
}
