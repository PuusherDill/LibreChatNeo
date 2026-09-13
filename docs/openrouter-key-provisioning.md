# OpenRouter Per-User Key Provisioning — Документация

## Зачем это нужно

Каждый пользователь получает **свой** OpenRouter API-ключ с лимитом кредитов.
Все расходы списываются с **основного баланса** администратора на OpenRouter.
Когда кредиты кончаются — чат блокируется, пока админ не пополнит лимит вручную через AdminPanel.

---

## Переменные окружения (`.env`)

| Переменная | Описание | Пример |
|---|---|---|
| `OPENROUTER_MANAGEMENT_KEY` | Management Key из openrouter.ai/settings/management-keys | `sk-or-m1-...` |
| `OPENROUTER_INITIAL_CREDIT_LIMIT` | Стартовый лимит для новых пользователей в USD | `5` |
| `OPENROUTER_ENCRYPT_SECRET` | 32-символьный секрет для шифрования ключей в БД | `abc123...xyz` |

---

## Изменённые / созданные файлы

### `packages/data-schemas/src/schema/user.ts`
Добавлены поля:
- `openrouterKeyHash` — hash ключа (select: false) для управления через API
- `openrouterKeyEncrypted` — зашифрованный plaintext ключа (select: false)
- `openrouterCreditLimit` — лимит в USD (кэш)
- `openrouterCreditUsed` — потрачено (кэш)
- `openrouterKeyDisabled` — заблокирован ли ключ

### `packages/data-schemas/src/types/user.ts`
Добавлены соответствующие TypeScript типы в `IUser`.

### `packages/data-schemas/src/schema/openrouterTopUp.ts` [НОВЫЙ]
Схема для хранения истории пополнений и подписок:
- `user` — ссылка на User
- `amount` — сумма пополнения в USD
- `newLimit` — новый лимит после пополнения
- `previousLimit` — предыдущий лимит
- `note` — комментарий от админа
- `addedBy` — ID администратора который пополнил
- `transactionType` — `topup` | `subscription`
- `subscriptionMonths` — на сколько месяцев (если подписка)
- `subscriptionExpiresAt` — когда истекает подписка

### `packages/data-schemas/src/models/openrouterTopUp.ts` [НОВЫЙ]
Фабрика Mongoose модели `OpenRouterTopUp`.

### `packages/data-schemas/src/models/index.ts`
Добавлен импорт и экспорт `OpenRouterTopUp` модели в `createModels`.

### `packages/data-schemas/src/types/index.ts`
Добавлен реэкспорт `./openrouterTopUp`.

### `packages/api/src/openrouter/OpenRouterKeyService.ts` [НОВЫЙ]
Сервис для работы с OpenRouter Management API:
- `createKeyForUser(userId, name, limitUsd)` — создаёт ключ, возвращает `{hash, keyEncrypted}`
- `getKeyStatus(keyHash)` — live статус ключа из OpenRouter API
- `updateKeyLimit(keyHash, newLimitUsd)` — PATCH лимита ключа
- `setKeyDisabled(keyHash, disabled)` — блокировка/разблокировка
- `listAllKeys(offset?)` — список всех ключей (для синка с БД)
- `decryptKey(encrypted)` — расшифровать ключ для подстановки в запрос

### `packages/api/src/openrouter/index.ts` [НОВЫЙ]
Реэкспорт сервиса.

### `packages/api/src/index.ts`
Добавлен `export * from './openrouter'`.

### `api/server/services/AuthService.js`
В функции `registerUser`: после успешного создания пользователя вызывается `createKeyForUser`.
Ключ сохраняется в `user.openrouterKeyHash` и `user.openrouterKeyEncrypted`.

### `api/server/routes/admin/openrouter.js` [НОВЫЙ]
REST API для административной панели:
- `GET /api/admin/openrouter/users` — список юзеров с данными ключей и расходами
- `POST /api/admin/openrouter/topup` — пополнить лимит
- `GET /api/admin/openrouter/key/:hash` — live статус ключа из OpenRouter
- `PATCH /api/admin/openrouter/key/:hash` — блокировка/разблокировка
- `GET /api/admin/openrouter/topups` — история всех пополнений
- `GET /api/admin/openrouter/reveal-key/:userId` — показать расшифрованный ключ (только ADMIN)

### `api/server/routes/index.js`
Добавлен `adminOpenRouter` в exports.

### `api/server/index.js`
Зарегистрирован `app.use('/api/admin/openrouter', routes.adminOpenRouter)`.

---

## Как работает шифрование ключей

Используется `AES-256-GCM` из Node.js `crypto`:
```
OPENROUTER_ENCRYPT_SECRET (32 байта) → ключ шифрования
Каждый ключ шифруется отдельно с уникальным IV
Хранится в БД как: "iv:tag:ciphertext" в base64
```

Для смены секрета нужно расшифровать все ключи старым и зашифровать новым.

---

## Как работает подстановка ключа при запросах

Для использования ключа пользователя при запросах к OpenRouter:

1. Когда LibreChat конфигурируется с endpoint `openrouter`, в `OPENROUTER_API_KEY` указывается **общий** ключ (fallback)
2. Для запросов зарегистрированных пользователей — middleware `openrouterKeyMiddleware` подставляет их персональный ключ автоматически
3. При исчерпании лимита OpenRouter вернёт `402 Payment Required` — middleware транслирует это в понятное сообщение

---

## Лимиты и пополнение

- **Стартовый лимит**: задаётся в `OPENROUTER_INITIAL_CREDIT_LIMIT` (default: 5 USD)
- **Пополнение**: Админ открывает `/admin` → OpenRouter Keys → выбирает пользователя → вводит сумму
- **Подписка**: Фиксированная сумма каждые N месяцев (хранится в `openrouterTopUp` с `transactionType: 'subscription'`)

---

## Добавление лимитов без кода (если хочешь допилить сам)

Если хочешь изменить логику (например добавить автопополнение), смотри:
1. `packages/api/src/openrouter/OpenRouterKeyService.ts` — весь HTTP к OpenRouter API
2. `api/server/routes/admin/openrouter.js` — REST endpoints
3. `packages/data-schemas/src/schema/openrouterTopUp.ts` — структура транзакций

OpenRouter Management API доки: https://openrouter.ai/docs/guides/overview/auth/management-api-keys
