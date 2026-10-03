'use client';

import { useCallback, useEffect, useState } from 'react';

const TOAST_DURATION_MS = 6000;

interface Toast {
  id: number;
  title: string;
  body: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((title: string, body: string) => {
    setToasts((current) => [...current, { id: Date.now() + Math.random(), title, body }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, showToast, dismissToast };
}

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:left-auto"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, onDismiss]);

  return (
    <button
      type="button"
      onClick={() => {
        onDismiss(toast.id);
      }}
      className="border-accent bg-surface rounded-card w-full max-w-sm border p-4 text-left shadow-lg"
    >
      <p className="text-accent text-sm font-semibold">{toast.title}</p>
      <p className="mt-1 text-sm">{toast.body}</p>
    </button>
  );
}
