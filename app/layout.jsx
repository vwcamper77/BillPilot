import "./globals.css";

export const metadata = {
  title: "Billie",
  description: "Your payday heads-up for bills.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
