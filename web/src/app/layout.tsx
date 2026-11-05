import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayNexus AI — Intelligent payment operations",
  description: "Investigate payment issues with autonomous AI, grounded evidence, and merchant-controlled guardrails.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
