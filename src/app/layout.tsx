import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from './sw-register';

export const metadata: Metadata = {
  title: 'Weekly Scheduler',
  description: 'Create and manage weekly work schedules',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Scheduler',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#3b82f6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Scheduler" />
      </head>
      <body className="bg-gray-50 min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
