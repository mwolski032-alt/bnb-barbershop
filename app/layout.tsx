import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="pl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
