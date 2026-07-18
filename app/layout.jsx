import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";
import Footer from "@/components/Footer";
import MetaPixel from "@/components/MetaPixel";
import AttributionTracker from "@/components/AttributionTracker";
import AnalyticsConsent from "@/components/AnalyticsConsent";
import TestAuthBridge from "@/components/TestAuthBridge";
import InternalAnalyticsBanner from "@/components/InternalAnalyticsBanner";
import ScrollToTopButton from "@/app/dashboard/components/ScrollToTopButton";
import { INTERNAL_ANALYTICS_COOKIE, verifyInternalAnalyticsCookie } from "@/lib/analytics/internal.server";
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  HOME_URL,
  SITE_URL,
  SOCIAL_IMAGE,
  SOCIAL_IMAGE_URL,
} from "@/lib/seo";

const isTestAuthBridgeEnabled = process.env.NODE_ENV !== "production";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const gtmContainerId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME_TITLE,
    template: "%s | ClearTill",
  },
  description: HOME_DESCRIPTION,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon/favicon.ico",
    apple: "/app-icons/apple-touch-icon-180x180.png",
  },
  openGraph: {
    type: "website",
    siteName: "ClearTill",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    locale: "en_GB",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [SOCIAL_IMAGE_URL],
  },
};

export const viewport = { themeColor: "#143C3A" };

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const internalAnalytics = verifyInternalAnalyticsCookie(cookieStore.get(INTERNAL_ANALYTICS_COOKIE)?.value);
  return (
    <html lang="en-GB">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `window.__CLEARTILL_INTERNAL_ANALYTICS__=${internalAnalytics ? "true" : "false"};` }} />
        {gtmContainerId && !internalAnalytics ? (
          <Script id="google-tag-manager" strategy="beforeInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtmContainerId}');`}
          </Script>
        ) : null}
        {gtmContainerId && !internalAnalytics ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmContainerId}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
              title="Google Tag Manager"
            />
          </noscript>
        ) : null}
        {internalAnalytics ? null : (
          <>
            <MetaPixel />
            {/* Mounted above AttributionTracker so Mixpanel is ready before
                the first mirrored product event fires. */}
            <AnalyticsConsent />
          </>
        )}
        <AttributionTracker />
        {isTestAuthBridgeEnabled ? <TestAuthBridge /> : null}
        {gaMeasurementId && !internalAnalytics ? (
          <>
            {/* A plain synchronous <script> (not next/script) — even
                strategy="beforeInteractive" defers execution to Next's runtime
                bootstrap via a __next_s queue, which still lands after
                DOMContentLoaded. The stub defining window.gtag must run while
                the browser is still parsing the HTML, or a trackGa4Event() call
                fired immediately on a fresh page load (e.g. an auth attempt
                right after landing on /billing) finds window.gtag undefined and
                is silently lost. Only the actual library fetch needs to stay
                async; it drains the queued dataLayer commands (js/config, then
                any events) once it loads. */}
            <script
              id="google-analytics"
              dangerouslySetInnerHTML={{
                __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}');
              `,
              }}
            />
            <Script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
          </>
        ) : null}
        <div className="app-frame">
          <InternalAnalyticsBanner active={internalAnalytics} />
          <div className="app-content">{children}</div>
          <Footer />
        </div>
        <ScrollToTopButton />
      </body>
    </html>
  );
}
