import React, { useEffect, useId, useRef } from 'react';
import ReactDOM from 'react-dom';

/**
 * Shared in-app confirmation surface.
 *
 * Native window.confirm/prompt block the renderer, ignore the app's design
 * system and cannot show validation or busy state. Every destructive action
 * uses this dialog instead.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

const lockBodyScroll = () => {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;
};

const unlockBodyScroll = () => {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
};

const ConfirmModal = ({
  isOpen,
  title,
  message,
  children,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDanger = false,
  busy = false,
  confirmDisabled = false
}) => {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef(null);
  const confirmRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreFocusRef.current = document.activeElement;
    lockBodyScroll();

    // Escape must close only the topmost dialog. Capture prevents the parent
    // modal's document-level Escape listener from also closing it.
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) onCancelRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const focusTimer = window.setTimeout(() => {
      const preferred = confirmRef.current && !confirmRef.current.disabled
        ? confirmRef.current
        : dialogRef.current?.querySelector(FOCUSABLE);
      preferred?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(focusTimer);
      unlockBodyScroll();
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (event) => {
    event.stopPropagation();
    if (event.target === event.currentTarget && !busy) onCancel?.();
  };

  return ReactDOM.createPortal(
    <div
      className="modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
    >
      <div
        ref={dialogRef}
        className="modal-box confirm-modal"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="modal-title confirm-modal-title">{title}</h2>
        {message && <p id={messageId} className="confirm-modal-message">{message}</p>}
        {children && <div className="confirm-modal-body">{children}</div>}
        <div className="modal-footer confirm-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={isDanger ? 'btn btn-danger-solid' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? 'Working…' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
