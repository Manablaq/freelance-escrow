import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
export const metadata: Metadata = {
  metadataBase: new URL("https://genmarket-escrow.vercel.app"),
  title: {
    default: "FreelanceMarket — Work secured on-chain",
    template: "%s | FreelanceMarket",
  },
  description:
    "Hire, deliver, and settle freelance work through on-chain escrow with AI-assisted verification on GenLayer Bradbury.",
  openGraph: {
    title: "FreelanceMarket",
    description: "Freelance work secured on-chain.",
    type: "website",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
