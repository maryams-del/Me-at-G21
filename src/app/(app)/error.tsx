"use client";
import { useEffect } from "react";
import Link from "next/link";

/** Friendly fallback if a page fails to load (e.g. the database is waking up or the connection dropped). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="panel p-6 grid gap-3 justify-items-start" role="alert">
      <h1 className="t-h2">This page didn’t load</h1>
      <p className="t-small text-ink-2 prose-w">
        It may be a dropped connection. Nothing you saved has been lost.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>Try again</button>
        <Link href="/" className="btn">Go to Today</Link>
      </div>
    </div>
  );
}
