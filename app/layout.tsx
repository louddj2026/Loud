import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 0.5,
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_CROWD_PUBLIC_ORIGIN ?? "http://localhost:3200"),
  title: "Crowd2 — Three-Deck Performance Booth",
  description: "A local, human-assisted three-deck DJ booth with learned cueing, grid mapping and live crowd feedback.",
  openGraph: {
    title: "Crowd2 — Three-Deck Performance Booth",
    description: "A human-assisted DJ booth with learned cueing, grid mapping and live crowd feedback.",
    type: "website",
    images: [{
      url: "/crowd2-social-preview.png",
      width: 1200,
      height: 630,
      alt: "A dark three-deck Crowd2 performance instrument with stacked waveforms and a connected mixer.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crowd2 — Three-Deck Performance Booth",
    description: "A human-assisted DJ booth with learned cueing, grid mapping and live crowd feedback.",
    images: ["/crowd2-social-preview.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
