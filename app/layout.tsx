import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./paper-components.css";
import "./salon.css";
import "./booking-wizard.css";
import "./motion.css";
import "./agenda.css";
import "./modals.css";
import "./panels.css";
import "./client-modern.css";
import "./telegram-feel.css";
import "./offline.css";
import ClientErrorMonitor from "./components/client-error-monitor";
import TapFeedback from "./components/tap-feedback";

export const metadata: Metadata = {
  title: "BNB Barbershop | Rezerwacje",
  description: "Niezależna aplikacja do umawiania usług barberskich.",
  applicationName: "BNB Barbershop",
  manifest: "/manifest.webmanifest?v=10",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
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
  themeColor: "#F6EBD7",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" data-bnb-app-shell="true">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link
          rel="preload"
          as="image"
          type="image/avif"
          imageSrcSet="/brand/bnb-hero-960.avif 960w, /brand/bnb-hero-1440.avif 1440w"
          imageSizes="(max-width: 700px) 100vw, 65vw"
          fetchPriority="high"
        />
        {["fraunces-latin", "fraunces-latin-ext", "geist-latin", "geist-latin-ext"].map((font) => (
          <link key={font} rel="preload" as="font" type="font/woff2" href={`/fonts/${font}.woff2`} crossOrigin="anonymous" />
        ))}
      </head>
      <body className="antialiased">
        <ClientErrorMonitor>{children}</ClientErrorMonitor>
        <TapFeedback />
      </body>
    </html>
  );
}
