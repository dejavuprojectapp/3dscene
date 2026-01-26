import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gaussian Splatting Viewer",
  description: "Visualizador de Gaussian Splatting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="overflow-hidden">{children}</body>
    </html>
  );
}
