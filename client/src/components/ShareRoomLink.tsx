import { useState } from 'react';

interface ShareRoomLinkProps {
  roomId: string;
}

export default function ShareRoomLink({ roomId }: ShareRoomLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/room/${roomId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden md:inline text-xs text-text-muted truncate max-w-[200px] font-semibold">{url}</span>
      <button
        onClick={handleCopy}
        className={`px-3.5 py-2 text-xs font-extrabold rounded-xl border-2
          transition-all duration-200 flex items-center gap-1.5
          ${copied
            ? 'border-green-500/30 text-green-400 bg-green-500/10'
            : 'border-white/10 text-text-muted hover:text-red-main hover:border-red-main/30 hover:bg-bg-card'
          }`}
      >
        {copied ? (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Kopyalandı!
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Linki kopyala
          </>
        )}
      </button>
    </div>
  );
}
