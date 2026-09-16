import { ChevronDown, Eye, EyeOff, Pin, Search } from 'lucide-react';

export function LibraryPageShell({ className = '', eyebrow, title, actions, query, onQueryChange, searchPlaceholder, error, children }) {
  return (
    <section className={`page ${className}`.trim()}>
      <div className="topbar">
        <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
        {actions && <div className="actions notebook-actions">{actions}</div>}
      </div>
      {onQueryChange && <label className="search grammar-search"><Search size={18} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={searchPlaceholder} /></label>}
      {error && <div className="sync-error">Firebase 同步失敗：{error}</div>}
      {children}
    </section>
  );
}

export function CollapsibleGroup({ className = '', variant = 'tag', collapsed, onToggle, title, countLabel, marker = '標籤', markerIcon, children }) {
  const isCategory = variant === 'category';
  return (
    <section className={`${className} ${collapsed ? 'collapsed' : ''}`.trim()}>
      <div className={isCategory ? 'note-category-header' : 'folder-tag-group-head'}>
        <button type="button" className={isCategory ? 'note-category-toggle' : 'folder-tag-group-toggle'} aria-expanded={!collapsed} onClick={onToggle} title={collapsed ? `展開${title}` : `收合${title}`}>
          <span className={isCategory ? 'note-category-heading' : 'folder-tag-group-heading'}>
            <span className={isCategory ? 'note-category-mark' : 'folder-tag-mark'}>{markerIcon || marker}</span>
            <h2>{title}</h2>
          </span>
          {isCategory && <span className="note-category-count">{countLabel}</span>}
          <ChevronDown size={isCategory ? 19 : 18} />
        </button>
        {!isCategory && <span>{countLabel}</span>}
      </div>
      {!collapsed && children}
    </section>
  );
}

export function EntityGrid({ className = '', children }) {
  return <div className={className}>{children}</div>;
}

export function EntityCardShell({ className = '', selected = false, onOpen, children }) {
  return <article className={`${className} clickable-card ${selected ? 'selected' : ''}`.trim()} onClick={onOpen}>{children}</article>;
}

export function LearnedVisibilityToggle({ hidden, count, noun, onToggle }) {
  return (
    <button type="button" className={`learned-visibility-button ${hidden ? 'active' : ''}`} aria-pressed={hidden} title={`${hidden ? '目前隱藏' : '目前顯示'} ${count} 個已學習${noun}`} onClick={onToggle}>
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}{hidden ? '隱藏已學習' : '顯示已學習'}
    </button>
  );
}

export function PinButton({ pinned, label, onToggle }) {
  return (
    <button type="button" className={`edit-icon-button pin-icon-button ${pinned ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onToggle(); }} aria-label={pinned ? `取消釘選${label}` : `釘選${label}`} title={pinned ? '取消釘選' : '釘選到最上方'}>
      <Pin size={15} />
    </button>
  );
}
