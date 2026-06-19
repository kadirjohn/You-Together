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
    if (role === 'owner') return <span className="text-xs bg-red-main/20 text-red-soft px-2 py-0.5 rounded-lg font-bold border border-red-main/20">Sahip</span>;
    if (role === 'admin') return <span className="text-xs bg-red-main/10 text-red-soft/80 px-2 py-0.5 rounded-lg font-bold border border-red-main/10">Admin</span>;
    return null;
  };

  return (
    <div className="bg-bg-panel border-[3px] border-white/5 rounded-3xl flex flex-col h-[calc(100vh-7rem)] lg:h-[calc(100vh-6rem)] shadow-cartoon-card">
      {/* Header */}
      <div className="px-4 py-3 border-b-[3px] border-white/5 flex items-center gap-2">
        <svg className="w-5 h-5 text-red-main" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="font-extrabold text-text-main text-sm">Sohbet</span>
        <span className="text-xs text-text-muted bg-bg-card px-2 py-0.5 rounded-lg font-bold border border-white/5">{messages.length}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-text-muted text-sm py-8 font-bold animate-bounce-in">
            <div className="text-4xl mb-2">💬</div>
            İlk mesajı yazan sen ol!
          </div>
        )}
        {messages.map((msg) => {
          const isSystem = msg.userId === 'system';
          const isMe = currentUser && msg.userId === currentUser.id;

          if (isSystem) {
            return (
              <div key={msg.id} className="text-center py-1">
                <span className="text-xs text-text-muted/60 font-semibold">{msg.text}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-fade-in`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-xs font-bold text-text-main">{msg.displayName}</span>
                {roleBadge(msg.role)}
              </div>
              <div
                className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm font-semibold border-2 ${
                  isMe
                    ? 'bg-red-main/20 text-text-main rounded-br-lg border-red-main/15'
                    : 'bg-bg-card text-text-main rounded-bl-lg border-white/5'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-3 border-t-[3px] border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Mesaj yaz..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={500}
            className="flex-1 px-4 py-2.5 bg-bg-card cartoon-input
              text-text-main placeholder-text-muted focus:outline-none
              text-sm font-semibold"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="px-4 py-2.5 bg-red-main text-white font-extrabold rounded-2xl
              cartoon-btn-sm hover:bg-red-soft
              disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
