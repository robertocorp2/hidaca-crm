import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "../app/design-system-showcase";

export const metadata = {
  title: "Sistema de diseño",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemShowcase />;
}
