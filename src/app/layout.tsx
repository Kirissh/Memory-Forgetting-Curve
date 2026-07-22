import type { Metadata } from "next";
import { Fraunces, Sora } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

const body = Sora({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Recall — revise what you're about to forget",
  description:
    "Upload material, auto-generate flashcards, and get a retention-model-ranked revision queue.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Rendered once here (not per-page) so the nav stays mounted across route
  // changes — the email is known server-side, so it never flips from the
  // logged-out layout to the logged-in one on navigation.
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="antialiased min-h-screen">
        <Nav email={user?.email} />
        {children}
      </body>
    </html>
  );
}
