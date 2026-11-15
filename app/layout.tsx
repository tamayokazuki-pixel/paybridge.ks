import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-host the same font families so builds do not depend on Google Fonts
// being reachable (licences are alongside the font files in app/fonts/).
const poppins = localFont({
  src: [
    { path: "./fonts/poppins-latin-100-normal.woff2", weight: "100", style: "normal" },
    { path: "./fonts/poppins-latin-200-normal.woff2", weight: "200", style: "normal" },
    { path: "./fonts/poppins-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/poppins-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "./fonts/poppins-latin-900-normal.woff2", weight: "900", style: "normal" }
  ],
  display: "swap",
  variable: "--font-poppins"
});

export const metadata: Metadata = {
  title: "paybridge.ks",
  description: "Modern, secure banking for everyone"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${poppins.className}`}>{children}</body>
    </html>
  );
}
