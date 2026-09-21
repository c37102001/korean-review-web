import { useEffect, useRef } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

export function ActionMenu({ label = '更多', icon: MenuIcon = MoreHorizontal, children, className = '' }) {
  const detailsRef = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target)) detailsRef.current.open = false;
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape' && detailsRef.current?.open) detailsRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);
  return (
    <details ref={detailsRef} className={`action-menu ${className}`.trim()}>
      <summary><MenuIcon size={18} /><span>{label}</span><ChevronDown className="action-menu-chevron" size={15} /></summary>
      <div className="action-menu-popover" onClick={(event) => {
        if (event.target.closest('button, a') && !event.target.closest('[data-menu-keep-open]')) {
          detailsRef.current?.removeAttribute('open');
        }
      }}>{children}</div>
    </details>
  );
}
