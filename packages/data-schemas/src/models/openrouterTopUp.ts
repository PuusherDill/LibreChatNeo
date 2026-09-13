import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import openrouterTopUpSchema from '~/schema/openrouterTopUp';

export function createOpenRouterTopUpModel(
  mongoose: typeof import('mongoose'),
): Model<t.IOpenRouterTopUp> {
  applyTenantIsolation(openrouterTopUpSchema);
  return (
    mongoose.models.OpenRouterTopUp ||
    mongoose.model<t.IOpenRouterTopUp>('OpenRouterTopUp', openrouterTopUpSchema)
  );
}
