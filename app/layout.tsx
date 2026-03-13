import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "./components/nav";
import GlobalDataBanner from "./components/global-data-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sports Dashboard",
  description: "MI Bivariate Poisson + Dixon-Coles + Elo betting model",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-zinc-950 text-white">
          <GlobalDataBanner />
          <header className="border-b border-zinc-800 px-6 py-4">
            <h1 className="text-2xl font-bold">Sports Dashboard</h1>
            <p className="text-sm text-zinc-400">
              MI Bivariate Poisson + Dixon-Coles + Elo
            </p>
          </header>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
