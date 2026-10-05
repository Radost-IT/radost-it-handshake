'use client';

import { useEffect, useState } from 'react';

const ACKNOWLEDGED_KEY = 'cookie-notice-acknowledged';

function isAcknowledged(): boolean {
  try {
    return localStorage.getItem(ACKNOWLEDGED_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeAcknowledged() {
  try {
    localStorage.setItem(ACKNOWLEDGED_KEY, 'true');
  } catch {
    // Storage can be blocked; the notice then shows again on the next visit.
  }
}

export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAcknowledged()) setOpen(true);
  }, []);

  const acknowledge = () => {
    storeAcknowledged();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((isOpen) => !isOpen);
        }}
        className="hover:text-ink transition-colors"
      >
        Cookie settings
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby="cookie-consent-title"
          className="border-line bg-surface/90 rounded-card fixed right-4 bottom-4 left-4 z-50 border p-5 shadow-2xl backdrop-blur-xl sm:left-auto sm:w-96"
        >
          <p id="cookie-consent-title" className="text-ink font-semibold">
            Cookie settings
          </p>
          <p className="text-muted mt-2 text-sm">
            We only use functional cookies to run the app, keep your Red Team Lab session and
            protect it from abuse. Our page statistics use no cookies. We use no preference or
            marketing cookies.
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={acknowledge}
              className="bg-accent text-on-accent rounded-full px-5 py-2 text-sm font-semibold"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
