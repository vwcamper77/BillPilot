import { HOME_URL, SITE_URL } from "./seo.js";

export const PAYDAY_CALCULATOR_PATH = "/tools/payday-cashflow-calculator";
export const PAYDAY_CALCULATOR_URL = `${SITE_URL}${PAYDAY_CALCULATOR_PATH}`;
export const PAYDAY_CALCULATOR_TITLE = "Payday cashflow calculator";
export const PAYDAY_CALCULATOR_DESCRIPTION = "Calculate what remains after bills and committed costs before your next income date. Free UK cashflow calculator with no bank connection or sign-up.";

export function createPaydayCalculatorSchemas() {
  return {
    breadcrumb: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: HOME_URL },
        { "@type": "ListItem", position: 2, name: "Free tools", item: `${SITE_URL}/blog#free-tools` },
        { "@type": "ListItem", position: 3, name: PAYDAY_CALCULATOR_TITLE, item: PAYDAY_CALCULATOR_URL },
      ],
    },
    application: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: PAYDAY_CALCULATOR_TITLE,
      description: PAYDAY_CALCULATOR_DESCRIPTION,
      url: PAYDAY_CALCULATOR_URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any operating system with a modern web browser",
      browserRequirements: "Requires JavaScript for the calculation; explanatory content remains available without it.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
      provider: { "@type": "Organization", name: "ClearTill", legalName: "GMBF Ventures Ltd", url: SITE_URL },
    },
  };
}
