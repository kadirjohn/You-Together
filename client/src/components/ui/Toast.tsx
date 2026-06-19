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
  const styles = {
    info: 'border-red-main/30 bg-bg-panel',
    success: 'border-green-500/30 bg-bg-panel',
    error: 'border-red-500/50 bg-bg-panel',
    warning: 'border-yellow-500/30 bg-bg-panel',
  };

  const icons = {
    info: '💡',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };

  return (
    <div
      className={`${styles[toast.type]} border-[3px] rounded-2xl px-4 py-3 shadow-cartoon-sm animate-slide-in
        flex items-center justify-between gap-3 max-w-sm`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base">{icons[toast.type]}</span>
        <p className="text-sm text-text-main font-bold">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-text-muted hover:text-red-main shrink-0 transition-colors duration-200"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
