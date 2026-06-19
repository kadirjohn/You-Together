import React from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative bg-bg-panel border-[3px] border-white/10 rounded-3xl p-6 w-full max-w-md shadow-cartoon-card animate-pop-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-3xl font-black text-text-main tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-bg-card border-2 border-white/10 flex items-center justify-center
              text-text-muted hover:text-red-main hover:border-red-main/30 hover:rotate-90
              transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
