import { useEffect, useState } from 'preact/hooks';
import {
  getDeviceSessionStatus,
  subscribeDeviceSessionStatus,
  type DeviceSessionStatus,
} from '../bootstrap/device-session';

/** Header badge shown only when the reader is not authenticated. */
export function DeviceSessionStatusBadge() {
  const [status, setStatus] = useState<DeviceSessionStatus>(getDeviceSessionStatus);

  useEffect(() => subscribeDeviceSessionStatus(setStatus), []);

  if (status.state !== 'error') return null;
  return (
    <div class="device-session-status device-session-status--error" title={status.lastError ?? undefined}>
      <span class="material-symbols-outlined device-session-status__icon">person_off</span>
      <span class="device-session-status__text">Not signed in</span>
    </div>
  );
}
