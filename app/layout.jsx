import "./globals.css";
import Footer from "@/components/Footer";

export const metadata = {
  title: "ClearTill",
  description: "Know you're clear till payday.",
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
    description: "Know you're clear till payday.",
    siteName: "ClearTill",
  },
};

export const viewport = { themeColor: "#143C3A" };

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>
        <div className="app-frame">
          <div className="app-content">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
