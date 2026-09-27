"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

export function MobileShellDialog({ open, onClose, title, side = "left", children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="terminal-mobile-backdrop" />
        <Dialog.Content
          className="terminal-mobile-drawer"
          data-side={side}
          aria-describedby={undefined}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <div className="terminal-mobile-drawer-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="terminal-mobile-icon" aria-label={`Close ${title}`} title={`Close ${title}`}>
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="terminal-mobile-drawer-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
