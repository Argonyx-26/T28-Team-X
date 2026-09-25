import type { Metadata, Viewport } from "next";
import { Hind, Kalam, Noto_Sans_Kannada } from "next/font/google";

import { RaahBeacon } from "@/components/site/raah";
import { SITE } from "@/lib/site";

import "./globals.css";

// Only the Latin files are preloaded; Devanagari still loads on demand for Hindi text (unicode-range)
const hind = Hind({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
});

// Kannada is only needed on student screens, so it isn't preloaded on every page
const notoSansKannada = Noto_Sans_Kannada({
  weight: ["400", "600"],
  subsets: ["kannada"],
  variable: "--font-kn",
  preload: false,
});

const kalam = Kalam({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-hand",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name}: ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["fractions", "misconceptions", "handwriting", "Kannada", "teachers", "formative assessment", "ARGONYX 26"],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name}: ${SITE.tagline}`,
    description: SITE.description,
    url: "/",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name}: ${SITE.tagline}`,
    description: SITE.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#fcfdff",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hind.variable} ${notoSansKannada.variable} ${kalam.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <RaahBeacon />
      </body>
    </html>
  );
}
