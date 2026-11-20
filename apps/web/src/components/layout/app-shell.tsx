'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { LogOut, Menu, Ship, X } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors',
            'focus-visible:ring-3 focus-visible:ring-ring/50',
            isActive(href)
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex">
        <Brand />
        <div className="flex-1">{nav}</div>
        <UserFooter />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r bg-background">
            <Brand />
            <div className="flex-1">{nav}</div>
            <UserFooter />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-semibold">StackDock</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b px-5">
      <Ship className="size-5" aria-hidden />
      <span className="font-semibold tracking-tight">StackDock</span>
    </div>
  );
}

function UserFooter() {
  const { state, logout } = useAuth();
  if (state.status !== 'signed-in') return null;
  return (
    <div className="flex items-center gap-2 border-t p-3">
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={state.user.email}
      >
        {state.user.email}
      </span>
      <button
        onClick={() => void logout()}
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
