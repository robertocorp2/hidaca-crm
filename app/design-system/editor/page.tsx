import { notFound } from "next/navigation";
import tokenDocument from "../../../../design-system/tokens.json";
import { DesignSystemTokenEditor } from "../../app/design-system-token-editor";

export const metadata = {
  title: "Editor de tokens · Sistema de diseño",
  robots: { index: false, follow: false },
};

export default function DesignSystemEditorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemTokenEditor document={tokenDocument} />;
}
