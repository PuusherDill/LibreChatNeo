import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  CreditCard,
  Key,
  ShieldAlert,
  Search,
  PlusCircle,
  RefreshCw,
  Eye,
  Lock,
  Unlock,
  History,
  DollarSign,
  UserCheck,
  Zap,
  Copy,
} from 'lucide-react';
import { Button, Input, Label, OGDialog, OGDialogTemplate, useToastContext, Spinner } from '@librechat/client';
import { request } from 'librechat-data-provider';

interface IUserORData {
  _id: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  openrouterCreditLimit?: number;
  openrouterCreditUsed?: number;
  openrouterKeyDisabled?: boolean;
  openrouterKeyHash?: string;
  createdAt: string;
}

interface ITopUpRecord {
  _id: string;
  user: { name?: string; email?: string } | string;
  amount: number;
  newLimit: number;
  previousLimit: number;
  note?: string;
  transactionType: 'topup' | 'subscription';
  subscriptionMonths?: number;
  addedBy?: { name?: string; email?: string };
  createdAt: string;
}

interface IStats {
  totalUsers: number;
  provisionedUsers: number;
  totalLimit: number;
  totalUsed: number;
  disabledKeys: number;
}

export default function OpenRouterAdminView() {
  const { showToast } = useToastContext();

  const [users, setUsers] = useState<IUserORData[]>([]);
  const [stats, setStats] = useState<IStats>({
    totalUsers: 0,
    provisionedUsers: 0,
    totalLimit: 0,
    totalUsed: 0,
    disabledKeys: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // TopUp Modal State
  const [topUpUser, setTopUpUser] = useState<IUserORData | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('5');
  const [topUpNote, setTopUpNote] = useState('');
  const [transType, setTransType] = useState<'topup' | 'subscription'>('topup');
  const [subMonths, setSubMonths] = useState('1');
  const [isTopUpSubmitting, setIsTopUpSubmitting] = useState(false);

  // Provision Modal State
  const [provisionUser, setProvisionUser] = useState<IUserORData | null>(null);
  const [provisionLimit, setProvisionLimit] = useState('5');
  const [customKey, setCustomKey] = useState('');
  const [isProvisionSubmitting, setIsProvisionSubmitting] = useState(false);

  // History Modal State
  const [historyUser, setHistoryUser] = useState<IUserORData | null>(null);
  const [userHistory, setUserHistory] = useState<ITopUpRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Reveal Modal State
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealingUser, setRevealingUser] = useState<IUserORData | null>(null);

  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, statsData, pendingData] = await Promise.all([
        request.get<any>('/api/admin/openrouter/users?limit=100'),
        request.get<any>('/api/admin/openrouter/stats'),
        request.get<any>('/api/admin/openrouter/pending'),
      ]);

      if (usersData?.users) {
        setUsers(usersData.users);
      }
      if (statsData) {
        setStats(statsData);
      }
      if (pendingData?.records) {
        setPendingRequests(pendingData.records);
      }
    } catch (err) {
      showToast({ message: 'Ошибка при загрузке данных OpenRouter Admin', status: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle Approve Pending Request
  const handleApprove = async (id: string) => {
    try {
      await request.post(`/api/admin/openrouter/approve/${id}`);
      showToast({ message: 'Заявка на пополнение успешно одобрена! Баланс зачислен.', status: 'success' });
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка при одобрении', status: 'error' });
    }
  };

  // Handle Reject Pending Request
  const handleReject = async (id: string) => {
    try {
      await request.post(`/api/admin/openrouter/reject/${id}`);
      showToast({ message: 'Заявка отклонена.', status: 'info' });
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка при отклонении', status: 'error' });
    }
  };

  // Handle Top-Up Submit
  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topUpUser) return;

    setIsTopUpSubmitting(true);
    try {
      const data = await request.post('/api/admin/openrouter/topup', {
        userId: topUpUser._id,
        amount: parseFloat(topUpAmount),
        note: topUpNote,
        transactionType: transType,
        subscriptionMonths: transType === 'subscription' ? parseInt(subMonths, 10) : undefined,
      });

      showToast({ message: `Баланс успешно пополнен! Новый лимит: $${data.newLimit}`, status: 'success' });
      setTopUpUser(null);
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка пополнения', status: 'error' });
    } finally {
      setIsTopUpSubmitting(false);
    }
  };

  // Handle Provision Submit
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provisionUser) return;

    setIsProvisionSubmitting(true);
    try {
      await request.post(`/api/admin/openrouter/provision/${provisionUser._id}`, {
        limitUsd: parseFloat(provisionLimit),
        customKey: customKey.trim() || undefined,
      });

      showToast({ message: 'API ключ успешно создан и привязан!', status: 'success' });
      setProvisionUser(null);
      setCustomKey('');
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка создания ключа', status: 'error' });
    } finally {
      setIsProvisionSubmitting(false);
    }
  };

  // Handle Toggle Key Status
  const handleToggleDisabled = async (user: IUserORData) => {
    if (!user.openrouterKeyHash) return;
    const newDisabled = !user.openrouterKeyDisabled;
    try {
      await request.patch(`/api/admin/openrouter/key/${user.openrouterKeyHash}`, {
        disabled: newDisabled,
      });

      showToast({
        message: `Ключ ${newDisabled ? 'заблокирован' : 'разблокирован'}`,
        status: 'success',
      });
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка изменения статуса', status: 'error' });
    }
  };

  // Handle Reveal Key
  const handleRevealKey = async (user: IUserORData) => {
    setRevealingUser(user);
    try {
      const data = await request.get<any>(`/api/admin/openrouter/reveal/${user._id}`);
      setRevealedKey(data.key);
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка получения ключа', status: 'error' });
      setRevealingUser(null);
    }
  };

  // Handle Fetch History
  const handleFetchHistory = async (user: IUserORData) => {
    setHistoryUser(user);
    setLoadingHistory(true);
    try {
      const data = await request.get<any>(`/api/admin/openrouter/topups/${user._id}`);
      setUserHistory(data.records || []);
    } catch (err: any) {
      showToast({ message: 'Ошибка загрузки истории', status: 'error' });
    } finally {
      setLoadingHistory(false);
    }
  };

  // Handle Provision All
  const handleProvisionAll = async () => {
    try {
      setLoading(true);
      const data = await request.post('/api/admin/openrouter/provision-all', { limitUsd: 10 });
      showToast({ message: `Ключи успешно созданы для ${data.count} пользователей!`, status: 'success' });
      fetchData();
    } catch (err: any) {
      showToast({ message: err.message || 'Ошибка массовой выдачи ключей', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const query = search.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.username && u.username.toLowerCase().includes(query))
    );
  });

  return (
    <div className="w-full h-full p-6 overflow-y-auto bg-surface-primary text-text-primary">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-text-primary">
            <Zap className="text-amber-500 size-6" /> OpenRouter Management Admin
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Управление лимитами, пополнениями и заявками на оплату по картам
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleProvisionAll} variant="outline" className="flex items-center gap-2 border-blue-500/30 text-blue-500 hover:bg-blue-500/10">
            <Key className="size-4" /> Выдать ключи всем ($10)
          </Button>
          <Button onClick={fetchData} variant="outline" className="flex items-center gap-2">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded-xl border border-border-subtle bg-surface-secondary flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-lg">
            <Users className="size-6" />
          </div>
          <div>
            <div className="text-xs text-text-secondary font-medium">Всего пользователей</div>
            <div className="text-xl font-bold text-text-primary">{stats.totalUsers}</div>
            <div className="text-xs text-blue-500 font-semibold">{stats.provisionedUsers} с ключом</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border-subtle bg-surface-secondary flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-lg">
            <CreditCard className="size-6" />
          </div>
          <div>
            <div className="text-xs text-text-secondary font-medium">Заявки по картам</div>
            <div className="text-xl font-bold text-amber-400">{pendingRequests.length}</div>
            <div className="text-xs text-amber-500 font-semibold">Ожидают проверки</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border-subtle bg-surface-secondary flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-lg">
            <DollarSign className="size-6" />
          </div>
          <div>
            <div className="text-xs text-text-secondary font-medium">Выделенный лимит</div>
            <div className="text-xl font-bold text-text-primary">${stats.totalLimit.toFixed(2)}</div>
            <div className="text-xs text-emerald-500">суммарно USD</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border-subtle bg-surface-secondary flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 text-purple-500 rounded-lg">
            <ShieldAlert className="size-6" />
          </div>
          <div>
            <div className="text-xs text-text-secondary font-medium">Заблокировано ключей</div>
            <div className="text-xl font-bold text-text-primary">{stats.disabledKeys}</div>
            <div className="text-xs text-purple-500">из {stats.provisionedUsers} активных</div>
          </div>
        </div>
      </div>

      {/* Pending Card Requests Section */}
      {pendingRequests.length > 0 && (
        <div className="mb-8 p-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-3">
          <h2 className="font-bold text-base text-amber-400 flex items-center gap-2">
            <CreditCard className="size-5" /> Заявки на пополнение картой ({pendingRequests.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-secondary">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-tertiary text-text-secondary text-xs uppercase font-semibold border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3">Пользователь</th>
                  <th className="px-4 py-3">Сумма (GEL / USD)</th>
                  <th className="px-4 py-3">Комментарий / Чек</th>
                  <th className="px-4 py-3">Дата</th>
                  <th className="px-4 py-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {pendingRequests.map((req) => (
                  <tr key={req._id} className="hover:bg-surface-tertiary/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {req.user?.name || req.user?.username || req.user?.email || 'Пользователь'}
                      <div className="text-xs text-text-secondary font-normal">{req.user?.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-emerald-400">₾{req.amountGel?.toFixed(2) ?? '0.00'} GEL</div>
                      <div className="text-xs text-text-secondary">~ ${req.amount.toFixed(2)} USD</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary italic max-w-xs truncate">
                      "{req.userComment || req.note || 'Без комментария'}"
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                      {new Date(req.createdAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(req._id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1 font-semibold"
                        >
                          Одобрить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(req._id)}
                          className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs px-3 py-1"
                        >
                          Отклонить
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
          <Input
            placeholder="Поиск по имени, логину или email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-xl border border-border-subtle overflow-hidden bg-surface-secondary shadow-sm">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-2">
            <Spinner className="size-8 text-amber-500" />
            <span className="text-sm text-text-secondary">Загрузка пользователей...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-tertiary text-text-secondary text-xs uppercase font-semibold border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3">Пользователь</th>
                  <th className="px-4 py-3">Статус ключа</th>
                  <th className="px-4 py-3">Лимит ($)</th>
                  <th className="px-4 py-3">Расход ($)</th>
                  <th className="px-4 py-3">Остаток ($)</th>
                  <th className="px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                      Пользователи не найдены
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const limit = user.openrouterCreditLimit ?? 0;
                    const used = user.openrouterCreditUsed ?? 0;
                    const remaining = Math.max(0, limit - used);
                    const isExhausted = limit > 0 && remaining <= 0;
                    const hasKey = !!user.openrouterKeyHash;

                    return (
                      <tr key={user._id} className="hover:bg-surface-tertiary/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-text-primary">{user.name || user.username || 'Без имени'}</div>
                          <div className="text-xs text-text-secondary">{user.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          {!hasKey ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              Не выдан
                            </span>
                          ) : user.openrouterKeyDisabled ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                              <Lock className="size-3" /> Заблокирован
                            </span>
                          ) : isExhausted ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              Исчерпан
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              <UserCheck className="size-3" /> Активен
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold">${limit.toFixed(2)}</td>
                        <td className="px-4 py-3 text-text-secondary">${used.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <div className={`font-semibold ${isExhausted ? 'text-red-500' : 'text-emerald-500'}`}>
                            ${remaining.toFixed(2)}
                          </div>
                          {limit > 0 && (
                            <div className="w-24 h-1.5 bg-surface-tertiary rounded-full mt-1 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isExhausted ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {hasKey ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setTopUpUser(user)}
                                  className="text-xs px-2.5 py-1 flex items-center gap-1 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                                >
                                  <PlusCircle className="size-3.5" /> +Баланс
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleToggleDisabled(user)}
                                  title={user.openrouterKeyDisabled ? 'Разблокировать' : 'Заблокировать'}
                                  className="p-1.5"
                                >
                                  {user.openrouterKeyDisabled ? (
                                    <Unlock className="size-4 text-emerald-500" />
                                  ) : (
                                    <Lock className="size-4 text-amber-500" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRevealKey(user)}
                                  title="Показать ключ"
                                  className="p-1.5"
                                >
                                  <Eye className="size-4 text-blue-500" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleFetchHistory(user)}
                                  title="История пополнений"
                                  className="p-1.5"
                                >
                                  <History className="size-4 text-purple-500" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setProvisionUser(user)}
                                className="text-xs px-2.5 py-1 flex items-center gap-1 border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
                              >
                                <Key className="size-3.5" /> Выдать ключ
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* TopUp Modal */}
      {topUpUser && (
        <OGDialog open={true} onOpenChange={() => setTopUpUser(null)}>
          <OGDialogTemplate
            title={`Пополнение баланса: ${topUpUser.name || topUpUser.email}`}
            showCloseButton={true}
            main={
              <form onSubmit={handleTopUpSubmit} className="space-y-4 pt-2">
                <div>
                  <Label>Текущий лимит: ${topUpUser.openrouterCreditLimit ?? 0}</Label>
                </div>

                <div>
                  <Label>Тип пополнения</Label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="transType"
                        checked={transType === 'topup'}
                        onChange={() => setTransType('topup')}
                      />
                      Разовое пополнение ($)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="transType"
                        checked={transType === 'subscription'}
                        onChange={() => setTransType('subscription')}
                      />
                      Подписка (ежемесячно)
                    </label>
                  </div>
                </div>

                <div>
                  <Label>Сумма пополнения (USD)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    required
                  />
                </div>

                {transType === 'subscription' && (
                  <div>
                    <Label>Длительность подписки (месяцев)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="12"
                      value={subMonths}
                      onChange={(e) => setSubMonths(e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <Label>Примечание / Комментарий от админа</Label>
                  <Input
                    placeholder="Например: Пополнение через Telegram Admin"
                    value={topUpNote}
                    onChange={(e) => setTopUpNote(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setTopUpUser(null)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={isTopUpSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {isTopUpSubmitting ? <Spinner className="size-4" /> : 'Пополнить баланс'}
                  </Button>
                </div>
              </form>
            }
          />
        </OGDialog>
      )}

      {/* Provision Modal */}
      {provisionUser && (
        <OGDialog open={true} onOpenChange={() => setProvisionUser(null)}>
          <OGDialogTemplate
            title={`Выдача OpenRouter ключа: ${provisionUser.name || provisionUser.email}`}
            showCloseButton={true}
            main={
              <form onSubmit={handleProvisionSubmit} className="space-y-4 pt-2">
                <div>
                  <Label>Стартовый лимит (USD)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={provisionLimit}
                    onChange={(e) => setProvisionLimit(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <Label>Свой API ключ (необязательно)</Label>
                  <Input
                    placeholder="Оставьте пустым для авто-генерации (sk-or-v1-...)"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    Если указать вручную, ключ сохранится в зашифрованном виде для этого пользователя.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setProvisionUser(null)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={isProvisionSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {isProvisionSubmitting ? <Spinner className="size-4" /> : 'Создать ключ'}
                  </Button>
                </div>
              </form>
            }
          />
        </OGDialog>
      )}

      {/* History Modal */}
      {historyUser && (
        <OGDialog open={true} onOpenChange={() => setHistoryUser(null)}>
          <OGDialogTemplate
            title={`История пополнений: ${historyUser.name || historyUser.email}`}
            showCloseButton={true}
            main={
              <div className="space-y-3 pt-2 max-h-[60vh] overflow-y-auto">
                {loadingHistory ? (
                  <div className="p-6 text-center">
                    <Spinner className="size-6 text-purple-500" />
                  </div>
                ) : userHistory.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-4">
                    История пополнений пуста
                  </p>
                ) : (
                  userHistory.map((rec) => (
                    <div key={rec._id} className="p-3 border border-border-subtle rounded-lg bg-surface-secondary text-sm">
                      <div className="flex justify-between font-semibold">
                        <span className="text-emerald-500">+${rec.amount.toFixed(2)} ({rec.transactionType})</span>
                        <span className="text-xs text-text-secondary">
                          {new Date(rec.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        Лимит изменён с ${rec.previousLimit} до ${rec.newLimit}
                      </div>
                      {rec.note && <div className="text-xs italic text-text-tertiary mt-1 font-medium">"{rec.note}"</div>}
                    </div>
                  ))
                )}
              </div>
            }
          />
        </OGDialog>
      )}

      {/* Reveal Key Modal */}
      {revealedKey && (
        <OGDialog open={true} onOpenChange={() => { setRevealedKey(null); setRevealingUser(null); }}>
          <OGDialogTemplate
            title={`Расшифрованный API ключ: ${revealingUser?.name || revealingUser?.email}`}
            showCloseButton={true}
            main={
              <div className="space-y-4 pt-2">
                <div className="p-3 bg-surface-tertiary border border-border-subtle rounded-lg text-xs font-mono break-all select-all flex items-center justify-between gap-2">
                  <span className="flex-1">{revealedKey}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(revealedKey);
                      showToast({ message: 'Ключ скопирован в буфер обмена', status: 'success' });
                    }}
                    className="text-xs px-2 py-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 flex items-center gap-1 shrink-0"
                  >
                    <Copy className="size-3.5" /> Скопировать
                  </Button>
                </div>
                <p className="text-xs text-amber-500">
                  ⚠️ Сохраняйте данный ключ в секрете.
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => { setRevealedKey(null); setRevealingUser(null); }}>
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
