import Link from "next/link";

export default function NotFound() {
  return <main className="simple-page"><p className="eyebrow">404</p><h1>Resource unavailable</h1><p>This resource does not exist or is no longer available. Hidden, quarantined, and deleted resources use the same response.</p><Link className="button" href="/resources">Back to resources</Link></main>;
}
