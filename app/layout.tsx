import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HIDACA Operaciones",
    template: "%s | HIDACA Operaciones",
  },
  description:
    "Sistema privado de CRM, empresas, contactos, proyectos y finanzas de HIDACA Constructora.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
