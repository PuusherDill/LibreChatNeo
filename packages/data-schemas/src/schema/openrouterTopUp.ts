import { Schema } from 'mongoose';
import type { IOpenRouterTopUp } from '~/types';

const openrouterTopUpSchema: Schema<IOpenRouterTopUp> = new Schema<IOpenRouterTopUp>(
  {
    /** The user this top-up or subscription belongs to */
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    /** USD amount added to the OpenRouter key limit */
    amount: {
      type: Number,
      required: true,
    },
    /** OpenRouter key limit after this transaction */
    newLimit: {
      type: Number,
      required: true,
    },
    /** OpenRouter key limit before this transaction */
    previousLimit: {
      type: Number,
      required: true,
    },
    /** Optional note from the admin */
    note: {
      type: String,
      default: '',
    },
    /** Admin user who performed the top-up */
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /** topup = one-time credit add; subscription = recurring monthly */
    transactionType: {
      type: String,
      enum: ['topup', 'subscription'],
      default: 'topup',
    },
    /** Number of months for subscription transactions */
    subscriptionMonths: {
      type: Number,
      default: null,
    },
    /** When the subscription expires (for subscription transactions) */
    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
    /** The OpenRouter key hash this transaction was applied to */
    openrouterKeyHash: {
      type: String,
      required: false,
      default: '',
    },
    amountGel: {
      type: Number,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed'],
      default: 'completed',
    },
    paymentMethod: {
      type: String,
      default: 'direct',
    },
    userComment: {
      type: String,
      default: '',
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

openrouterTopUpSchema.index({ user: 1, createdAt: -1 });
openrouterTopUpSchema.index({ addedBy: 1, createdAt: -1 });

export default openrouterTopUpSchema;
