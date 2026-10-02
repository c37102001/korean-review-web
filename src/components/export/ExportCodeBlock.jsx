export function ExportCodeBlock({ content, label, className = '' }) {
  return (
    <pre className={`json-code export-content ${className}`.trim()} aria-label={label} tabIndex={0}>
      <code>{content}</code>
    </pre>
  );
}
