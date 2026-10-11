import type { Metadata } from "next";
import ShelfLibrary from "../../components/library/ShelfLibrary";

export const metadata: Metadata = { title: "Kitaplığım" };

export default function LibraryPage() {
  return <ShelfLibrary />;
}
