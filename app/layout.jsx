import Script from "next/script";
import "./globals.css";
import Footer from "@/components/Footer";
import MetaPixel from "@/components/MetaPixel";
import AttributionTracker from "@/components/AttributionTracker";
import TestAuthBridge from "@/components/TestAuthBridge";

const isTestAuthBridgeEnabled = process.env.NODE_ENV !== "production";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const gtmContainerId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;

export const metadata = {
  title: "ClearTill",
  description: "Know you're clear till you're paid.",
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
    title: "ClearTill",
    description: "Know you're clear till you're paid.",
    siteName: "ClearTill",
  },
};

export const viewport = { themeColor: "#143C3A" };

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>
        {gtmContainerId ? (
          <Script id="google-tag-manager" strategy="beforeInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtmContainerId}');`}
          </Script>
        ) : null}
        {gtmContainerId ? (
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
        <MetaPixel />
        <AttributionTracker />
        {isTestAuthBridgeEnabled ? <TestAuthBridge /> : null}
        {gaMeasurementId ? (
          <>
            <Script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}');
              `}
            </Script>
          </>
        ) : null}
        <div className="app-frame">
          <div className="app-content">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
