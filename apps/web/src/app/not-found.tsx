import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          Back to overview
        </Link>
      </p>
    </div>
  );
}
