'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './theme-toggle';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 8);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled ? 'border-line bg-canvas/70 backdrop-blur-xl' : 'border-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3 rounded-md">
          {/* Pre-sized at twice the display size, so it needs no image optimizer. */}
          <img src="/logo-112.webp" alt="" width={44} height={44} className="rounded-lg" />
          <span className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">Handshake</span>
            <span className="text-accent text-xs font-semibold tracking-widest uppercase">
              by Radost IT
            </span>
          </span>
        </Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
