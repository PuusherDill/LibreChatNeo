import React from 'react';
import { Label, InfoHoverCard, ESide } from '@librechat/client';
import { useAuthContext, useLocalize } from '~/hooks';

interface TokenCreditsItemProps {
  tokenCredits?: number;
}

const TokenCreditsItem: React.FC<TokenCreditsItemProps> = () => {
  const { user } = useAuthContext();
  const localize = useLocalize();

  const limit = user?.openrouterCreditLimit ?? 0;
  const used = user?.openrouterCreditUsed ?? 0;
  const remaining = Math.max(0, limit - used);

  return (
    <div className="flex items-center justify-between py-1">
      {/* Left Section: Label */}
      <div className="flex items-center space-x-2">
        <Label className="font-light">{localize('com_nav_balance')}</Label>
        <InfoHoverCard side={ESide.Bottom} text="Доступный остаток баланса для ИИ моделей" />
      </div>

      {/* Right Section: Synchronized USD Value */}
      <span className="text-base font-bold text-emerald-500 font-mono" role="note">
        ${remaining.toFixed(2)} USD
      </span>
    </div>
  );
};

export default TokenCreditsItem;
