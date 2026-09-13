import type { Document, Types } from 'mongoose';

/** Top-up or subscription transaction for a user's OpenRouter key */
export interface IOpenRouterTopUp extends Document {
  /** The user this transaction belongs to */
  user: Types.ObjectId;
  /** USD amount added to the OpenRouter key limit */
  amount: number;
  /** OpenRouter key limit after this transaction */
  newLimit: number;
  /** OpenRouter key limit before this transaction */
  previousLimit: number;
  /** Optional note from the admin */
  note?: string;
  /** Admin user who performed the top-up */
  addedBy: Types.ObjectId;
  /** topup = one-time credit add; subscription = recurring monthly */
  transactionType: 'topup' | 'subscription';
  /** Number of months for subscription transactions */
  subscriptionMonths?: number | null;
  /** When the subscription expires (for subscription transactions) */
  subscriptionExpiresAt?: Date | null;
  /** The OpenRouter key hash this transaction was applied to */
  openrouterKeyHash: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Plain object representation for API responses */
export interface IOpenRouterTopUpDTO {
  _id: string;
  user: string;
  amount: number;
  newLimit: number;
  previousLimit: number;
  note?: string;
  addedBy: string;
  transactionType: 'topup' | 'subscription';
  subscriptionMonths?: number | null;
  subscriptionExpiresAt?: string | null;
  openrouterKeyHash: string;
  createdAt: string;
}

/** OpenRouter key status as returned by the Management API */
export interface IOpenRouterKeyStatus {
  hash: string;
  label: string;
  name: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
}
