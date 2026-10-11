import type { Metadata } from "next";

export const metadata: Metadata = { title: "Waitlist" };

export default function WaitlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
