import type { Metadata } from "next";
import { Hind, Noto_Sans_Kannada, Kalam } from "next/font/google";
import "./globals.css";

const hind = Hind({
  weight: ["400", "500", "600"],
  subsets: ["latin", "devanagari"],
  variable: "--font-sans",
});

const notoSansKannada = Noto_Sans_Kannada({
  weight: ["400", "600"],
  subsets: ["kannada"],
  variable: "--font-kn",
});

const kalam = Kalam({
  weight: ["400", "700"],
  subsets: ["latin", "devanagari"],
  variable: "--font-hand",
});

export const metadata: Metadata = {
  title: "GuruGraph",
  description: "See why they got it wrong.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hind.variable} ${notoSansKannada.variable} ${kalam.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
