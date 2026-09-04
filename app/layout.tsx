import type { Metadata, Viewport } from "next";
import "./globals.css";

const performanceProfileScript = `
  (() => {
    try {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const memory = Number(navigator.deviceMemory) || 0;
      const cores = Number(navigator.hardwareConcurrency) || 0;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const reduceEffects = Boolean(
        reduceMotion ||
        connection?.saveData ||
        (memory > 0 && memory <= 4) ||
        (cores > 0 && cores <= 4)
      );
      document.documentElement.classList.toggle("reduced-effects", reduceEffects);
    } catch {}
  })();
`;

export const metadata: Metadata = {
  title: "BNB Barbershop | Rezerwacje",
  description: "Niezależna aplikacja do umawiania usług barberskich.",
  applicationName: "BNB Barbershop",
  manifest: "/manifest.webmanifest?v=3",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BNB Barber",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png?v=3",
    apple: "/icons/apple-touch-icon.png?v=3",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: performanceProfileScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
