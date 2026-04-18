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

const TAGLINE = 'Sales intelligence for medtech, in chat.';

export const metadata: Metadata = {
  title: 'PathovAI',
  description: TAGLINE,
  icons: {
    icon: [
      { url: '/logo/pathovai-mark-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/logo/pathovai-mark-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/logo/pathovai-mark-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [
      { url: '/logo/pathovai-mark-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'PathovAI',
    description: TAGLINE,
    siteName: 'PathovAI',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PathovAI',
    description: TAGLINE,
    images: ['/og.png'],
  },
};

// Must mirror --color-bg in app/globals.css. Kept as a literal string
// because the Next viewport API serializes into a <meta name="theme-color">
// tag at build time and can't read CSS custom properties.
export const viewport = {
  themeColor: '#0a0a0a',
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
