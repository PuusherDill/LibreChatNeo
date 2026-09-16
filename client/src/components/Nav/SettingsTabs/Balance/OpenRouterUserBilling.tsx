import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  PlusCircle,
  History,
  CheckCircle2,
  Calendar,
  Sparkles,
  AlertCircle,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import { Button, Input, Label, OGDialog, OGDialogTemplate, useToastContext, Spinner } from '@librechat/client';
import { request } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

interface ITransaction {
  _id: string;
  amount: number;
  newLimit: number;
  previousLimit: number;
  note?: string;
  transactionType: 'topup' | 'subscription';
  subscriptionMonths?: number;
  createdAt: string;
}

interface IBalanceData {
  hasKey: boolean;
  creditLimit: number;
  creditUsed: number;
  remaining: number;
  disabled: boolean;
}

export default function OpenRouterUserBilling() {
  const { showToast } = useToastContext();
  const { user } = useAuthContext();

  const [balance, setBalance] = useState<IBalanceData>({
    hasKey: !!user?.openrouterKeyHash,
    creditLimit: user?.openrouterCreditLimit ?? 0,
    creditUsed: user?.openrouterCreditUsed ?? 0,
    remaining: Math.max(0, (user?.openrouterCreditLimit ?? 0) - (user?.openrouterCreditUsed ?? 0)),
    disabled: user?.openrouterKeyDisabled ?? false,
  });

  const [loading, setLoading] = useState(false);

  // Modals
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Top Up Form State
  const [amount, setAmount] = useState<string>('5');
  const [transType, setTransType] = useState<'topup' | 'subscription'>('topup');
  const [subMonths, setSubMonths] = useState<number>(1);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [minError, setMinError] = useState<string>('');

  // History State
  const [history, setHistory] = useState<ITransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      const data = await request.get<IBalanceData>('/api/openrouter/balance');
      if (data) {
        setBalance(data);
      }
    } catch (err) {
      // Fallback to local user context if endpoint fails
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await request.get<{ records: ITransaction[] }>('/api/openrouter/history');
      setHistory(data.records || []);
    } catch (err: any) {
      showToast({ message: 'Ошибка при загрузке истории транзакций', status: 'error' });
    } finally {
      setLoadingHistory(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const handleAmountChange = (val: string) => {
    setAmount(val);
    const num = parseFloat(val);
    if (isNaN(num) || num < 5) {
      setMinError('Минимальная сумма пополнения — $5.00');
    } else {
      setMinError('');
    }
  };

  const selectPreset = (preset: number) => {
    setAmount(preset.toString());
    setMinError('');
  };

  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 5) {
      setMinError('Минимальная сумма пополнения — $5.00');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await request.post<any>('/api/openrouter/topup', {
        amount: numAmount,
        transactionType: transType,
        subscriptionMonths: transType === 'subscription' ? subMonths : undefined,
        note,
      });

      showToast({
        message: `Баланс успешно пополнен на $${numAmount.toFixed(2)}! Новый лимит: $${res.newLimit}`,
        status: 'success',
      });

      setShowTopUpModal(false);
      setNote('');
      fetchBalance();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка пополнения баланса', status: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isExhausted = balance.creditLimit > 0 && balance.remaining <= 0;

  return (
    <div className="w-full mt-4 p-4 rounded-xl border border-border-subtle bg-surface-secondary/80 backdrop-blur-sm space-y-4">
      {/* Header & Balance Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="font-semibold text-text-primary text-base flex items-center gap-2">
              Баланс ИИ OpenRouter
              {balance.disabled ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                  Заблокирован
                </span>
              ) : isExhausted ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  Исчерпан
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  Активен
                </span>
              )}
            </div>
            <div className="text-xs text-text-secondary mt-0.5">
              Лимит средств для мгновенного доступа к ИИ моделям
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setShowHistoryModal(true);
              fetchHistory();
            }}
            variant="outline"
            className="flex items-center gap-1.5 text-xs py-1.5 border-border-subtle hover:bg-surface-tertiary"
          >
            <History className="size-3.5 text-purple-400" />
            История
          </Button>

          <Button
            size="sm"
            onClick={() => setShowTopUpModal(true)}
            className="flex items-center gap-1.5 text-xs py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
          >
            <PlusCircle className="size-3.5" />
            Пополнить
          </Button>
        </div>
      </div>

      {/* Progress Bar & Amounts */}
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <div className="text-xs text-text-secondary">Остаток на счёте:</div>
          <div className={`text-xl font-extrabold ${isExhausted ? 'text-red-500' : 'text-emerald-500'}`}>
            ${balance.remaining.toFixed(2)} USD
          </div>
        </div>

        <div className="w-full bg-surface-tertiary h-2.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isExhausted ? 'bg-red-500' : 'bg-gradient-to-r from-emerald-500 to-teal-400'
            }`}
            style={{
              width: `${Math.min(100, balance.creditLimit > 0 ? (balance.creditUsed / balance.creditLimit) * 100 : 0)}%`,
            }}
          />
        </div>

        <div className="flex justify-between text-xs text-text-secondary pt-0.5">
          <span>Всего выделено: <strong className="text-text-primary">${balance.creditLimit.toFixed(2)}</strong></span>
          <span>Использовано: <strong className="text-text-primary">${balance.creditUsed.toFixed(2)}</strong></span>
        </div>
      </div>

      {/* Top Up / Subscription Modal */}
      {showTopUpModal && (
        <OGDialog open={true} onOpenChange={() => setShowTopUpModal(false)}>
          <OGDialogTemplate
            title="Пополнение баланса и подписка"
            showCloseButton={true}
          >
            <form onSubmit={handleTopUpSubmit} className="space-y-5 pt-2">
              {/* Type Selection */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase text-text-secondary">Тип пополнения</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTransType('topup')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                      transType === 'topup'
                        ? 'border-emerald-500 bg-emerald-500/10 text-text-primary'
                        : 'border-border-subtle bg-surface-tertiary/50 text-text-secondary hover:border-border-medium'
                    }`}
                  >
                    <DollarSign className={`size-5 mt-0.5 ${transType === 'topup' ? 'text-emerald-500' : 'text-text-tertiary'}`} />
                    <div>
                      <div className="font-semibold text-sm">Разовое пополнение</div>
                      <div className="text-xs opacity-75 mt-0.5">Пополнение лимита на выбранную сумму</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTransType('subscription')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                      transType === 'subscription'
                        ? 'border-emerald-500 bg-emerald-500/10 text-text-primary'
                        : 'border-border-subtle bg-surface-tertiary/50 text-text-secondary hover:border-border-medium'
                    }`}
                  >
                    <Calendar className={`size-5 mt-0.5 ${transType === 'subscription' ? 'text-emerald-500' : 'text-text-tertiary'}`} />
                    <div>
                      <div className="font-semibold text-sm">Подписка (ежемесячно)</div>
                      <div className="text-xs opacity-75 mt-0.5">Регулярное пополнение каждый месяц</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase text-text-secondary">Выберите сумму ($ USD)</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 25, 50].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      className={`py-2 px-3 rounded-lg border font-semibold text-sm transition-all ${
                        amount === preset.toString()
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                          : 'border-border-subtle bg-surface-tertiary text-text-primary hover:bg-surface-tertiary/80'
                      }`}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Amount Input */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-text-secondary">Или введите свою сумму (мин. $5.00)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
                  <Input
                    type="number"
                    step="1"
                    min="5"
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder="Например: 15"
                    className="pl-9 font-semibold text-base"
                    required
                  />
                </div>
                {minError && (
                  <p className="text-xs text-red-400 flex items-center gap-1 mt-1 font-medium">
                    <AlertCircle className="size-3.5" /> {minError}
                  </p>
                )}
              </div>

              {/* Subscription Duration */}
              {transType === 'subscription' && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase text-text-secondary">Длительность подписки</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 3, 6, 12].map((months) => (
                      <button
                        key={months}
                        type="button"
                        onClick={() => setSubMonths(months)}
                        className={`py-2 px-2 rounded-lg border text-xs font-semibold transition-all ${
                          subMonths === months
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : 'border-border-subtle bg-surface-tertiary text-text-secondary'
                        }`}
                      >
                        {months} {months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Note / Comment */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-text-secondary">Примечание (необязательно)</Label>
                <Input
                  placeholder="Комментарий к транзакции"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
                <Button type="button" variant="outline" onClick={() => setShowTopUpModal(false)}>
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !!minError}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5"
                >
                  {isSubmitting ? (
                    <Spinner className="size-4" />
                  ) : (
                    `Пополнить на $${parseFloat(amount || '0').toFixed(2)}`
                  )}
                </Button>
              </div>
            </form>
          </OGDialogTemplate>
        </OGDialog>
      )}

      {/* Transaction History Modal */}
      {showHistoryModal && (
        <OGDialog open={true} onOpenChange={() => setShowHistoryModal(false)}>
          <OGDialogTemplate
            title="История транзакций"
            showCloseButton={true}
          >
            <div className="space-y-3 pt-2 max-h-[60vh] overflow-y-auto">
              {loadingHistory ? (
                <div className="p-8 flex flex-col items-center justify-center gap-2">
                  <Spinner className="size-7 text-purple-500" />
                  <span className="text-xs text-text-secondary">Загрузка транзакций...</span>
                </div>
              ) : history.length === 0 ? (
                <div className="py-8 text-center text-text-secondary text-sm">
                  История пополнений пуста
                </div>
              ) : (
                history.map((tx) => (
                  <div
                    key={tx._id}
                    className="p-3.5 rounded-xl border border-border-subtle bg-surface-tertiary/40 space-y-1.5"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-emerald-500 text-base">
                          +${tx.amount.toFixed(2)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {tx.transactionType === 'subscription' ? 'Подписка' : 'Пополнение'}
                        </span>
                      </div>
                      <span className="text-xs text-text-secondary font-mono">
                        {new Date(tx.createdAt).toLocaleString('ru-RU')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>Лимит: ${tx.previousLimit.toFixed(2)} ➔ <strong className="text-text-primary">${tx.newLimit.toFixed(2)}</strong></span>
                    </div>

                    {tx.note && (
                      <div className="text-xs text-text-tertiary italic pt-0.5">
                        "{tx.note}"
                      </div>
                    )}
                  </div>
                ))
              )}

              <div className="flex justify-end pt-3">
                <Button variant="outline" onClick={() => setShowHistoryModal(false)}>
                  Закрыть
                </Button>
              </div>
            </div>
          </OGDialogTemplate>
        </OGDialog>
      )}
    </div>
  );
}
