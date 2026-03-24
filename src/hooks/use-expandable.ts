import { useState } from 'preact/hooks';

export function useExpandable(
  id: string,
  isRead: boolean,
  markReadFn: (id: string) => void
) {
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    if (!expanded && !isRead) {
      markReadFn(id);
    }
    setExpanded((v) => !v);
  }

  return { expanded, toggle };
}
