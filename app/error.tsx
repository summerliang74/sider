"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="simple-page"><h1>This page could not be loaded.</h1><p>The service kept the operation closed rather than continuing without its required security or storage dependency.</p><button className="button" type="button" onClick={reset}>Try again</button></main>;
}
