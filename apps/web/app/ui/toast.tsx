"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import "./toast.css";

interface ToastItem {
  id: number;
  text: string;
}

const ToastContext = createContext<((text: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  function push(text: string) {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, text }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 5000);
  }
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="ui-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div className="ui-toast" role="status" key={toast.id}>
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (text: string) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("ToastProvider missing");
  return push;
}
