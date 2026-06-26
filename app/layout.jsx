import "./globals.css";

export const metadata = {
  title: "BillPilot",
  description: "AI-powered bill heads-up app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
