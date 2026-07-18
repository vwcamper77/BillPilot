export const SITE_URL = "https://www.cleartill.money";
export const HOME_URL = `${SITE_URL}/`;
export const HOME_TITLE = "ClearTill — UK Cashflow and Payday Planning App";
export const HOME_DESCRIPTION = "ClearTill shows what is safe to spend after bills until your next income date. Plan your cashflow without connecting your bank or using Open Banking.";
export const SOCIAL_IMAGE_URL = `${SITE_URL}/social/cleartill-og-v2.png`;
export const LOGO_URL = `${SITE_URL}/logo/logo-horizontal.png`;

export const SOCIAL_IMAGE = {
  url: SOCIAL_IMAGE_URL,
  secureUrl: SOCIAL_IMAGE_URL,
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "ClearTill cashflow-planning app",
};

export function canonicalUrl(path = "/") {
  if (path === "/") return HOME_URL;
  return `${SITE_URL}/${String(path).replace(/^\/+|\/+$/g, "")}`;
}

export function createPageMetadata({ title, description, path, type = "website" }) {
  const url = canonicalUrl(path);
  const socialTitle = `${title} | ClearTill`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      siteName: "ClearTill",
      title: socialTitle,
      description,
      url,
      locale: "en_GB",
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [SOCIAL_IMAGE_URL],
    },
  };
}

export const PRIVATE_PAGE_ROBOTS = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
};
