import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import LogoutButton from "./logout-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dota Balancer",
  description: "Split a pool of players into balanced teams and run the bracket.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const authed = isValidSession(cookieStore.get(SESSION_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {authed && (
          <header className="sticky top-0 z-20 panel border-x-0 border-t-0">
            <nav className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3.5">
              <Link href="/" className="flex items-baseline gap-2 font-semibold tracking-tight">
                <span className="text-lg">Dota Balancer</span>
              </Link>
              <div className="ml-auto flex items-center gap-1 text-sm">
                <Link
                  href="/"
                  className="rounded-full px-3 py-1.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Teams
                </Link>
                <Link
                  href="/bracket"
                  className="rounded-full px-3 py-1.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Bracket
                </Link>
                <LogoutButton />
              </div>
            </nav>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
