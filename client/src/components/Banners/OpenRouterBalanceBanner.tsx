import { AlertTriangle, Lock, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@librechat/client';
import { useAuthContext } from '~/hooks';

export function OpenRouterBalanceBanner() {
  const { user } = useAuthContext();
  const [copied, setCopied] = useState(false);

  if (!user) {
    return null;
  }

  const limit = user.openrouterCreditLimit ?? 0;
  const used = user.openrouterCreditUsed ?? 0;
  const remaining = Math.max(0, limit - used);
  const isDisabled = !!user.openrouterKeyDisabled;
  const isExhausted = limit > 0 && remaining <= 0;

  if (!isDisabled && !isExhausted) {
    return null;
  }

  const handleCopyId = () => {
    if (user?.id || user?._id) {
      navigator.clipboard.writeText(user.id || user._id || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="w-full bg-red-600/90 text-white px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 shadow-md border-b border-red-700 text-sm font-medium z-30">
      <div className="flex items-center gap-2">
        {isDisabled ? (
          <Lock className="size-5 shrink-0 text-amber-300" />
        ) : (
          <AlertTriangle className="size-5 shrink-0 text-amber-300 animate-pulse" />
        )}
        <span>
          {isDisabled ? (
            <>Ваш доступ к OpenRouter ИИ заблокирован администратором.</>
          ) : (
            <>
              Баланс OpenRouter исчерпан! Потрачено <strong>${used.toFixed(2)}</strong> из <strong>${limit.toFixed(2)} USD</strong>.
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs opacity-90 hidden md:inline">
          Сообщите администратору ваш ID для пополнения
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopyId}
          className="text-xs bg-white/10 hover:bg-white/20 border-white/30 text-white flex items-center gap-1.5 py-1 px-2.5"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Скопировано!' : 'Скопировать ID'}
        </Button>
      </div>
    </div>
  );
}
