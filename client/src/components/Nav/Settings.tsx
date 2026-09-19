import type { TDialogProps } from '~/common';
import { SettingsDialog } from './Settings/index';
import type { SettingsTab } from './Settings/types';

export default function Settings(props: TDialogProps & { initialTab?: SettingsTab }) {
  return <SettingsDialog {...props} />;
}

