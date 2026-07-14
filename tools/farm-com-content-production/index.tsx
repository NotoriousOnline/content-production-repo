"use client";

import { ContentProductionTool } from "@/tools/content-production/ContentProductionTool";
import { config } from "./config";

export default function FarmComContentProductionToolPage() {
  return (
    <ContentProductionTool
      config={config}
      apiPrefix="/api/farm-com-content-production"
      cmsName="Shopify"
      siteFields="shopify"
      showLinkSync={false}
    />
  );
}
