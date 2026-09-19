import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  PlusCircle,
  History,
  CheckCircle2,
  Calendar,
  Sparkles,
  AlertCircle,
  Coins,
  TrendingUp,
} from 'lucide-react';
import { Button, Input, Label, OGDialog, OGDialogTemplate, useToastContext, Spinner } from '@librechat/client';
import { request } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

interface ITransaction {
  _id: string;
  amount: number;
  amountGel?: number;
  newLimit: number;
  previousLimit: number;
  note?: string;
  userComment?: string;
  paymentMethod?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'completed';
  transactionType: 'topup' | 'subscription';
  subscriptionMonths?: number;
  createdAt: string;
}

interface IBalanceData {
  hasKey: boolean;
  creditLimit: number;
  creditUsed: number;
  remaining: number;
  balanceGel?: number;
  limitGel?: number;
  usedGel?: number;
  gelPerUsd?: number;
  minTopUpGel?: number;
  presetPackagesGel?: number[];
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
    balanceGel: Math.max(0, ((user?.openrouterCreditLimit ?? 0) - (user?.openrouterCreditUsed ?? 0)) * 2.70),
    gelPerUsd: 2.70,
    minTopUpGel: 10,
    presetPackagesGel: [15, 20, 35, 45],
    disabled: user?.openrouterKeyDisabled ?? false,
  });

  // Modals
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Top Up Form State
  const gelRate = balance.gelPerUsd || 2.70;
  const minGel = balance.minTopUpGel || 10;
  const presets = balance.presetPackagesGel || [15, 20, 35, 45];

  const [paymentMethod, setPaymentMethod] = useState<'card' | 'instant'>('card');
  const [amountGel, setAmountGel] = useState<string>('15');
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

  const handleAmountGelChange = (val: string) => {
    setAmountGel(val);
    const num = parseFloat(val);
    if (isNaN(num) || num < minGel) {
      setMinError(`Минимальная сумма пополнения — ${minGel} GEL`);
    } else {
      setMinError('');
    }
  };

  const selectPreset = (preset: number) => {
    setAmountGel(preset.toString());
    setMinError('');
  };

  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numGel = parseFloat(amountGel);
    if (isNaN(numGel) || numGel < minGel) {
      setMinError(`Минимальная сумма пополнения — ${minGel} GEL`);
      return;
    }

    setIsSubmitting(true);
    try {
      if (paymentMethod === 'card') {
        await request.post('/api/openrouter/card-request', {
          amountGel: numGel,
          transactionType: transType,
          userComment: note,
        });

        showToast({
          message: `Заявка на пополнение ₾${numGel.toFixed(2)} GEL успешно отправлена! Проверка занимает 2-5 минут.`,
          status: 'success',
        });
      } else {
        await request.post('/api/openrouter/topup', {
          amountGel: numGel,
          transactionType: transType,
          subscriptionMonths: transType === 'subscription' ? subMonths : undefined,
          note,
        });

        const convertedUsd = (numGel / gelRate).toFixed(2);
        showToast({
          message: `Баланс успешно пополнен на ₾${numGel.toFixed(2)} GEL ($${convertedUsd} USD)!`,
          status: 'success',
        });
      }

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
  const currentGelBalance = balance.balanceGel ?? parseFloat((balance.remaining * gelRate).toFixed(2));
  const calcUsd = !isNaN(parseFloat(amountGel)) ? (parseFloat(amountGel) / gelRate).toFixed(2) : '0.00';

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
              Баланс ИИ Аккаунта (GEL / USD)
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
              Единый счет для быстрого использования всех нейросетей
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
            Пополнить баланс
          </Button>
        </div>
      </div>

      {/* Progress Bar & Amounts */}
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <div className="text-xs text-text-secondary">Остаток на счёте:</div>
          <div className="text-right">
            <div className={`text-2xl font-extrabold ${isExhausted ? 'text-red-500' : 'text-emerald-500'}`}>
              ₾{currentGelBalance.toFixed(2)} GEL
            </div>
            <div className="text-xs text-text-secondary font-mono">
              ~ ${balance.remaining.toFixed(2)} USD
            </div>
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
          <span>Всего выделено: <strong className="text-text-primary">₾{(balance.limitGel ?? (balance.creditLimit * gelRate)).toFixed(2)} GEL (${balance.creditLimit.toFixed(2)} USD)</strong></span>
          <span>Использовано: <strong className="text-text-primary">₾{(balance.usedGel ?? (balance.creditUsed * gelRate)).toFixed(2)} GEL (${balance.creditUsed.toFixed(2)} USD)</strong></span>
        </div>
      </div>

      {/* Top Up / Subscription Modal */}
      {showTopUpModal && (
        <OGDialog open={true} onOpenChange={() => setShowTopUpModal(false)}>
          <OGDialogTemplate
            title="Пополнение баланса аккаунта"
            showCloseButton={true}
            main={
              <form onSubmit={handleTopUpSubmit} className="space-y-4 pt-2">
                {/* Payment Method Selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-text-secondary">Способ оплаты</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                        paymentMethod === 'card'
                          ? 'border-emerald-500 bg-emerald-500/10 text-text-primary'
                          : 'border-border-subtle bg-surface-tertiary/50 text-text-secondary hover:border-border-medium'
                      }`}
                    >
                      <CreditCard className={`size-5 mt-0.5 ${paymentMethod === 'card' ? 'text-emerald-500' : 'text-text-tertiary'}`} />
                      <div>
                        <div className="font-semibold text-sm">Перевод на карту (P2P)</div>
                        <div className="text-xs opacity-75 mt-0.5">Оплата с любой карты без ИП и комиссий</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('instant')}
                      className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                        paymentMethod === 'instant'
                          ? 'border-emerald-500 bg-emerald-500/10 text-text-primary'
                          : 'border-border-subtle bg-surface-tertiary/50 text-text-secondary hover:border-border-medium'
                      }`}
                    >
                      <Sparkles className={`size-5 mt-0.5 ${paymentMethod === 'instant' ? 'text-emerald-500' : 'text-text-tertiary'}`} />
                      <div>
                        <div className="font-semibold text-sm">Мгновенный авто-платеж</div>
                        <div className="text-xs opacity-75 mt-0.5">Прямое автопополнение баланса</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Card Transfer Instructions */}
                {paymentMethod === 'card' && (
                  <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                    <div className="font-semibold text-xs uppercase text-emerald-400 flex items-center gap-1.5">
                      <CreditCard className="size-4" /> Реквизиты для перевода (Лари ₾ / Рубли ₽)
                    </div>
                    <div className="text-xs space-y-1 text-text-primary font-mono bg-surface-tertiary/80 p-2.5 rounded-lg border border-border-subtle">
                      <div>Bank of Georgia (GEL): <strong className="select-all text-emerald-400">GE40BG0000000123456789</strong></div>
                      <div>TBC Bank (GEL): <strong className="select-all text-emerald-400">GE89TB7700000012345678</strong></div>
                      <div>Карта МИР / Сбер (₽): <strong className="select-all text-emerald-400">2202 2000 1234 5678</strong></div>
                    </div>
                    <div className="text-[11px] text-text-secondary">
                      💡 Переведите сумму на любую из карт выше, укажите имя отправителя или чек ниже и нажмите <strong>«Отправить заявку»</strong>.
                    </div>
                  </div>
                )}

                {/* Presets GEL */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-text-secondary">Выберите пакет (Лари ₾)</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {presets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => selectPreset(preset)}
                        className={`py-2.5 px-3 rounded-xl border font-bold text-sm transition-all flex flex-col items-center justify-center ${
                          amountGel === preset.toString()
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400 shadow-sm'
                            : 'border-border-subtle bg-surface-tertiary text-text-primary hover:bg-surface-tertiary/80'
                        }`}
                      >
                        <span>{preset} GEL</span>
                        <span className="text-[10px] font-normal opacity-70">~ ${(preset / gelRate).toFixed(2)} USD</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Amount Input */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-text-secondary">Или введите свою сумму (мин. {minGel} GEL)</Label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-emerald-500">₾</span>
                    <Input
                      type="number"
                      step="1"
                      min={minGel}
                      value={amountGel}
                      onChange={(e) => handleAmountGelChange(e.target.value)}
                      placeholder="Например: 15"
                      className="pl-9 font-semibold text-base"
                      required
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary font-mono">
                      ≈ ${calcUsd} USD
                    </div>
                  </div>
                  {minError && (
                    <p className="text-xs text-red-400 flex items-center gap-1 mt-1 font-medium">
                      <AlertCircle className="size-3.5" /> {minError}
                    </p>
                  )}
                </div>

                {/* Note / Comment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-text-secondary">
                    {paymentMethod === 'card' ? 'Имя отправителя / Номер перевода или чека' : 'Примечание (необязательно)'}
                  </Label>
                  <Input
                    placeholder={paymentMethod === 'card' ? 'Например: Иван П., чек #987213' : 'Комментарий к транзакции'}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    required={paymentMethod === 'card'}
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
                    ) : paymentMethod === 'card' ? (
                      `Отправить заявку на ₾${parseFloat(amountGel || '0').toFixed(2)} GEL`
                    ) : (
                      `Пополнить на ₾${parseFloat(amountGel || '0').toFixed(2)} GEL`
                    )}
                  </Button>
                </div>
              </form>
            }
          />
        </OGDialog>
      )}

      {/* Transaction History Modal */}
      {showHistoryModal && (
        <OGDialog open={true} onOpenChange={() => setShowHistoryModal(false)}>
          <OGDialogTemplate
            title="История транзакций"
            showCloseButton={true}
            main={
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
                            +{tx.amountGel ? `₾${tx.amountGel.toFixed(2)} GEL` : `$${tx.amount.toFixed(2)} USD`}
                          </span>
                          {tx.status === 'pending' ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              В обработке
                            </span>
                          ) : tx.status === 'rejected' ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                              Отклонено
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              {tx.transactionType === 'subscription' ? 'Подписка' : 'Пополнение'}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-text-secondary font-mono">
                          {new Date(tx.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-text-secondary">
                        <span>Лимит: ${tx.previousLimit.toFixed(2)} ➔ <strong className="text-text-primary">${tx.newLimit.toFixed(2)}</strong></span>
                        {tx.paymentMethod && <span className="uppercase text-[10px] opacity-75">{tx.paymentMethod}</span>}
                      </div>

                      {(tx.userComment || tx.note) && (
                        <div className="text-xs text-text-tertiary italic pt-0.5">
                          "{tx.userComment || tx.note}"
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
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
