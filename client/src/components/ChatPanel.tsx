import { useState, useRef, useEffect } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';

export default function ChatPanel() {
  const messages = useRoomStore((s) => s.chatMessages);
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const { addToast } = useUIStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCount = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    lastMessageCount.current = messages.length;
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !room) return;

    setSending(true);
    getSocket().emit('chat:message', {
      roomId: room.id,
      text: trimmed,
    });
    setText('');
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const roleBadge = (role: string) => {
    if (role === 'owner') return <span className="text-xs bg-red-main/20 text-red-soft px-1.5 py-0.5 rounded">Sahip</span>;
    if (role === 'admin') return <span className="text-xs bg-red-main/10 text-red-soft/80 px-1.5 py-0.5 rounded">Admin</span>;
    return null;
  };

  return (
    <div className="bg-bg-panel border border-white/5 rounded-2xl flex flex-col h-[calc(100vh-7rem)] lg:h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="font-semibold text-text-main text-sm">Sohbet</span>
        <span className="text-xs text-text-muted">{messages.length}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-text-muted text-sm py-8">
            Henüz mesaj yok. İlk mesajı sen yaz!
          </div>
        )}
        {messages.map((msg) => {
          const isSystem = msg.userId === 'system';
          const isMe = currentUser && msg.userId === currentUser.id;

          if (isSystem) {
            return (
              <div key={msg.id} className="text-center py-1">
                <span className="text-xs text-text-muted/60">{msg.text}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-fade-in`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-xs font-semibold text-text-main">{msg.displayName}</span>
                {roleBadge(msg.role)}
              </div>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                  isMe
                    ? 'bg-red-main/20 text-text-main rounded-br-sm'
                    : 'bg-bg-card text-text-main rounded-bl-sm border border-white/5'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Mesaj yaz..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={500}
            className="flex-1 px-3 py-2.5 bg-bg-card border border-white/10 rounded-xl
              text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
              transition-colors text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="px-3 py-2.5 bg-red-main text-white font-semibold rounded-xl
              glow-red-sm hover:glow-red transition-all duration-300
              disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
