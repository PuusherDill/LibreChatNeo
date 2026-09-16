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

      {/* Right Section: Synchronized GEL / USD Value */}
      <span className="text-sm font-extrabold text-emerald-500 font-mono" role="note">
        ₾{(remaining * 2.70).toFixed(2)} GEL <span className="text-xs font-normal opacity-75">(${remaining.toFixed(2)} USD)</span>
      </span>
    </div>
  );
};

export default TokenCreditsItem;
