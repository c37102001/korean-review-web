import { useEffect, useRef } from 'react';

export function useSessionWakeLock(active) {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const release = async () => {
      const wakeLock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (!wakeLock || wakeLock.released) return;
      try {
        await wakeLock.release();
      } catch {
        // Browsers may release the lock themselves when a page is hidden.
      }
    };
    const request = async () => {
      if (!mounted || !active || document.visibilityState !== 'visible' || !navigator.wakeLock || wakeLockRef.current) return;
      try {
        const wakeLock = await navigator.wakeLock.request('screen');
        if (!mounted || !active) {
          await wakeLock.release();
          return;
        }
        wakeLockRef.current = wakeLock;
        wakeLock.addEventListener('release', () => {
          if (wakeLockRef.current === wakeLock) wakeLockRef.current = null;
        });
      } catch {
        // Unsupported devices keep their normal screen timeout behavior.
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') request();
      else release();
    };

    if (active) request();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      release();
    };
  }, [active]);
}
