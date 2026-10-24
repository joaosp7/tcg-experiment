import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: {
    default: "Build Divide",
    template: "%s · Build Divide",
  },
  description: "Browse, search, and filter Build Divide cards.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
          <header className="mb-6 border-b border-line pb-4">
            <Link href="/" className="inline-block">
              <p className="font-display text-4xl leading-none tracking-[0.16em] text-stock sm:text-5xl">
                BUILD DIVIDE
              </p>
              <p className="mt-1 text-[0.7rem] tracking-[0.32em] text-gold uppercase">Card catalog</p>
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
