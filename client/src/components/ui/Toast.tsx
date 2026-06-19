interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  const colors = {
    info: 'border-red-main/30 bg-bg-panel',
    success: 'border-green-500/30 bg-bg-panel',
    error: 'border-red-500/50 bg-bg-panel',
    warning: 'border-yellow-500/30 bg-bg-panel',
  };

  return (
    <div
      className={`${colors[toast.type]} border rounded-xl px-4 py-3 shadow-lg animate-slide-in
        flex items-center justify-between gap-3 max-w-sm`}
    >
      <p className="text-sm text-text-main">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-text-muted hover:text-text-main shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
