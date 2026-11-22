"use client";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

/** Back to wherever the file was opened from (the document, usually); straight to the document if there's no history. */
export function ViewerBack({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}>
      <Icon name="back" size={17} />Back
    </button>
  );
}
