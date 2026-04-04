import { useEffect, useState } from 'preact/hooks';
import {
  getDeviceSessionStatus,
  subscribeDeviceSessionStatus,
  type DeviceSessionStatus,
} from '../bootstrap/device-session';

function statusMeta(status: DeviceSessionStatus): { icon: string; text: string; className: string } {
  if (status.state === 'stream_active') {
    return { icon: 'cloud_done', text: 'Stream active', className: 'device-session-status--ok' };
  }
  if (status.state === 'stream_disconnected') {
    return { icon: 'cloud_off', text: 'Stream disconnected', className: 'device-session-status--warn' };
  }
  return { icon: 'person_off', text: 'Not registered', className: 'device-session-status--error' };
}

export function DeviceSessionStatusBadge() {
  const [status, setStatus] = useState<DeviceSessionStatus>(getDeviceSessionStatus);

  useEffect(() => subscribeDeviceSessionStatus(setStatus), []);

  const meta = statusMeta(status);
  return (
    <div class={`device-session-status ${meta.className}`} title={status.lastError ?? undefined}>
      <span class="material-symbols-outlined device-session-status__icon">{meta.icon}</span>
      <span class="device-session-status__text">{meta.text}</span>
    </div>
  );
}
