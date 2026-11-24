import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';
import { TelegramBotModal } from './TelegramBotModal.tsx';

export const TelegramBotBadge: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [subscribersCount, setSubscribersCount] = useState<number>(0);
  const [botOnline, setBotOnline] = useState<boolean>(true);
  const [botUsername, setBotUsername] = useState<string>('Forex_new_calender_bot');

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        if (res.ok) {
          const data = await res.json();
          setSubscribersCount(data.subscribersCount ?? 0);
          setBotOnline(data.botStatus === 'ONLINE');
          if (data.bot?.username) {
            setBotUsername(data.bot.username);
          }
        }
      } catch {
        // Soft fallback
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 25000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        title={`Telegram Bot @${botUsername} (${subscribersCount} subscriber${subscribersCount === 1 ? '' : 's'})`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold bg-[#222B36] hover:bg-[#354251]/60 text-[#E8E5DE] border border-[#354251] transition-all cursor-pointer group shadow-sm"
      >
        <div className="relative flex items-center justify-center text-[#6C9D91] group-hover:scale-110 transition-transform">
          <Send className="w-3.5 h-3.5 -rotate-12 translate-x-0.5" />
          <span
            className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full ${
              botOnline ? 'bg-[#72A98B] animate-pulse' : 'bg-[#B7797D]'
            }`}
          />
        </div>
        <span className="hidden md:inline text-[11px] font-bold text-[#E8E5DE]">
          Telegram
        </span>
        {subscribersCount > 0 ? (
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-[#6C9D91]/25 border border-[#6C9D91]/40 text-[#6C9D91]">
            {subscribersCount}
          </span>
        ) : (
          <span className="hidden xl:inline text-[9px] text-[#AAB4BF] font-normal">
            Link
          </span>
        )}
      </button>

      <TelegramBotModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};
