import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const LOGO_URL = '/PATHOVA_LOGO1_edited_edited_edited.png';
const TAGLINE = 'Sales intelligence for medtech, in chat.';

export const metadata: Metadata = {
  title: 'PathovAI',
  description: TAGLINE,
  icons: {
    icon: LOGO_URL,
    apple: LOGO_URL,
  },
  openGraph: {
    title: 'PathovAI',
    description: TAGLINE,
    siteName: 'PathovAI',
    images: [{ url: LOGO_URL }],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'PathovAI',
    description: TAGLINE,
    images: [LOGO_URL],
  },
};

export const viewport = {
  themeColor: '#020617',
  viewportFit: 'cover' as const,
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
                <body className="min-h-full flex flex-col"><Providers>{children}</Providers></body>
    </html>
  );
}
