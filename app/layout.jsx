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
      <body>{children}</body>
    </html>
  );
}
