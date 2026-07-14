import type { ComponentType } from "react";
import { config as articleTitleDiscoveryConfig } from "@/tools/article-title-discovery/config";
import ArticleTitleDiscoveryTool from "@/tools/article-title-discovery/index";
import { config as contentProductionConfig } from "@/tools/content-production/config";
import ContentProductionTool from "@/tools/content-production/index";
import { config as socialAutomationConfig } from "@/tools/social-automation/config";
import SocialAutomationTool from "@/tools/social-automation/index";
import { config as farmComContentProductionConfig } from "@/tools/farm-com-content-production/config";
import FarmComContentProductionTool from "@/tools/farm-com-content-production/index";
import { config as weedComContentProductionConfig } from "@/tools/weed-com-content-production/config";
import WeedComContentProductionTool from "@/tools/weed-com-content-production/index";
import { config as weedComRankMathConfig } from "@/tools/weed-com-rank-math/config";
import WeedComRankMathTool from "@/tools/weed-com-rank-math/index";
import { config as weedComStrainPageConfig } from "@/tools/weed-com-strain-page/config";
import WeedComStrainPageTool from "@/tools/weed-com-strain-page/index";
import { config as weedComStrainComparisonConfig } from "@/tools/weed-com-strain-comparison/config";
import WeedComStrainComparisonTool from "@/tools/weed-com-strain-comparison/index";

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
    slug: farmComContentProductionConfig.slug,
    name: farmComContentProductionConfig.name,
    description: farmComContentProductionConfig.description,
    icon: farmComContentProductionConfig.icon,
  },
  {
    slug: weedComRankMathConfig.slug,
    name: weedComRankMathConfig.name,
    description: weedComRankMathConfig.description,
    icon: weedComRankMathConfig.icon,
  },
  {
    slug: weedComStrainComparisonConfig.slug,
    name: weedComStrainComparisonConfig.name,
    description: weedComStrainComparisonConfig.description,
    icon: weedComStrainComparisonConfig.icon,
  },
  {
    slug: weedComStrainPageConfig.slug,
    name: weedComStrainPageConfig.name,
    description: weedComStrainPageConfig.description,
    icon: weedComStrainPageConfig.icon,
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
  "farm-com-content-production": FarmComContentProductionTool,
  "weed-com-rank-math": WeedComRankMathTool,
  "weed-com-strain-comparison": WeedComStrainComparisonTool,
  "weed-com-strain-page": WeedComStrainPageTool,
  "social-automation": SocialAutomationTool,
};

export function getToolConfig(slug: string): ToolConfig | undefined {
  return tools.find((t) => t.slug === slug);
}

export function getToolComponent(slug: string): ComponentType | undefined {
  return componentMap[slug];
}
