import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "./components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Serie A Predictor",
  description: "Dixon-Coles match prediction model for Italian Serie A",
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
          <header className="border-b border-zinc-800 px-6 py-4">
            <h1 className="text-2xl font-bold">Serie A Predictor</h1>
            <p className="text-sm text-zinc-400">
              Dixon-Coles model with xG integration
            </p>
          </header>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
