// Minimal, dependency-free markdown renderer for short freeform text (task
// and execution-step notes — suggestions.md #4). Supports **bold**,
// *italic*, `inline code`, [links](url), "- "/"* " bullet lists, and
// blank-line paragraphs. Deliberately not a full CommonMark implementation —
// notes are a sentence or two, not documents.

function renderInline(text, keyPrefix) {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern).filter((p) => p !== '');

  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-white/10 text-[0.9em] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      // Notes are agent-writable and (suggestions.md #12) may one day be
      // shared read-only, so a `javascript:`/`data:` href can't be allowed
      // to render as a live link — fall back to plain text for anything
      // that isn't http(s) or mailto.
      if (/^(https?:|mailto:)/i.test(linkMatch[2].trim())) {
        return (
          <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
            {linkMatch[1]}
          </a>
        );
      }
      return linkMatch[1];
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/**
 * @param {{ text: string, className?: string }} props
 */
export default function MarkdownText({ text, className = '' }) {
  if (!text?.trim()) return null;

  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));

        if (isList) {
          return (
            <ul key={bi} className={`list-disc list-inside space-y-0.5 ${bi > 0 ? 'mt-2' : ''}`}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.trim().replace(/^[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className={bi > 0 ? 'mt-2' : ''}>
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l, `${bi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
