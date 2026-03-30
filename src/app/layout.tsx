import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WhatsApp Manager - Multi-Account Dashboard",
  description: "Manage multiple WhatsApp accounts with AI-powered auto-responder and real-time monitoring. Built with Next.js and Baileys.",
  keywords: ["WhatsApp", "Multi-Account", "AI", "Auto-Responder", "Baileys", "Next.js", "Dashboard"],
  authors: [{ name: "WhatsApp Manager" }],
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>",
  },
  openGraph: {
    title: "WhatsApp Manager",
    description: "Multi-Account WhatsApp Management Dashboard",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WhatsApp Manager",
    description: "Multi-Account WhatsApp Management Dashboard",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
