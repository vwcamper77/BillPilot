import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "ClearTill — Know you're clear till payday",
  description: "Add your balance snapshot, payday and bills. ClearTill shows what's due before payday and what may be left after.",
  openGraph: {
    title: "ClearTill — Know you're clear till payday",
    description: "No bank connection. No spending tracking. Just a simple payday heads-up.",
    siteName: "ClearTill",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>
        <div className="app-frame">
          <div className="app-content">{children}</div>
          <footer className="site-footer">
            <span>&copy; ClearTill</span>
            <div className="site-footer-links">
              <Link href="/terms">Terms of Service</Link>
              <span aria-hidden="true">&middot;</span>
              <Link href="/privacy">Privacy Policy</Link>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
