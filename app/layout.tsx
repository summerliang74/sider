import type { Metadata } from "next";

import "./styles.css";

export const metadata: Metadata = {
  title: { default: "Sider", template: "%s · Sider" },
  description: "A private, searchable shelf for SHSID student knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
