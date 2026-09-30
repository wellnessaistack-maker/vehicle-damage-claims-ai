import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Claims first review",
  description: "Prototype: AI reads vehicle damage photos, written rules decide where the claim goes, and a person sees why.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
