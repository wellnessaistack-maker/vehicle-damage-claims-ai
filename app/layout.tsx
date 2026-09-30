import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Claims first review",
  description: "Prototype: a customer's photo in, AI reads the car and the damage, and your reviewer approves or routes the claim with the reasons in view.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
