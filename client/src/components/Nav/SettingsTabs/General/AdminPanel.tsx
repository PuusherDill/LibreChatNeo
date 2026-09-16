import { ExternalLink, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Label, Button } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';

export default function AdminPanel() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const adminPanelURL = startupConfig?.adminPanelURL ?? '';

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <Label id="openrouter-admin-label">OpenRouter Keys Admin</Label>
          <Button
            variant="outline"
            aria-labelledby="openrouter-admin-label"
            onClick={() => navigate('/admin/openrouter')}
            className="flex items-center gap-1.5"
          >
            <Key className="size-4 text-amber-500" />
            Управление ключами
          </Button>
        </div>
      )}

      {adminPanelURL && (
        <div className="flex items-center justify-between">
          <Label id="admin-panel-label">{localize('com_ui_admin_panel')}</Label>
          <Button asChild variant="outline" aria-labelledby="admin-panel-label">
            <a href={adminPanelURL} target="_blank" rel="noopener noreferrer">
              {localize('com_ui_open_var', { 0: localize('com_ui_admin_panel') })}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
