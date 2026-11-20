import type { Metadata } from 'next';
import { RootShell } from '@/components/layout/root-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'StackDock',
  description: 'Private deploy dashboard',
  robots: { index: false, follow: false },
};

// Applies the OS dark-mode preference before first paint (no flash).
const themeScript = `(() => {
  const m = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => document.documentElement.classList.toggle('dark', m.matches);
  apply(); m.addEventListener('change', apply);
})();`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
