import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-host the same font families so builds do not depend on Google Fonts
// being reachable (licences are alongside the font files in app/fonts/).
const dmSans = localFont({
  src: "./fonts/dm-sans-latin-variable.woff2",
  weight: "100 1000",
  display: "swap",
  variable: "--font-dm-sans"
});

const playfair = localFont({
  src: "./fonts/playfair-display-latin-variable.woff2",
  weight: "400 900",
  display: "swap",
  variable: "--font-playfair"
});

export const metadata: Metadata = {
  title: "paybridge.ks",
  description: "Modern, secure banking for everyone"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${playfair.variable}`}>{children}</body>
    </html>
  );
}
