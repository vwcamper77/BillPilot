import { SITE_URL } from "./seo.js";

const DEFAULT_GMBF_VENTURES_URL = "https://gmbf-ventures.vercel.app/";

function publicHttpsUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback).trim());
    return url.protocol === "https:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}

export const GMBF_VENTURES_URL = publicHttpsUrl(
  process.env.NEXT_PUBLIC_GMBF_VENTURES_URL,
  DEFAULT_GMBF_VENTURES_URL,
);

export const PRODUCT_URLS = Object.freeze({
  cleartill: `${SITE_URL}/`,
  setthedate: "https://plan.setthedate.app/",
  talostv: "https://talostv.com/",
});

export const GMBF_ORGANIZATION_ID = `${GMBF_VENTURES_URL}#organization`;
export const GMBF_LOGO_URL = `${SITE_URL}/brand/gmbf/gmbf-mark-monochrome-navy.svg`;

export function createGmbfOrganizationSchema() {
  return {
    "@type": "Organization",
    "@id": GMBF_ORGANIZATION_ID,
    name: "GMBF Ventures Ltd",
    legalName: "GMBF Ventures Ltd",
    url: GMBF_VENTURES_URL,
    logo: {
      "@type": "ImageObject",
      url: GMBF_LOGO_URL,
    },
    identifier: {
      "@type": "PropertyValue",
      propertyID: "Companies House company number",
      value: "17286832",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "124 City Road",
      addressLocality: "London",
      postalCode: "EC1V 2NX",
      addressCountry: "GB",
    },
  };
}
