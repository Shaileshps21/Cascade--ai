/**
 * ResourceLink — renders a knowledge resource as a real link when the LLM
 * gave a confident URL, or as inert plain text otherwise. The agent
 * deliberately leaves `url` empty rather than guessing (a wrong link is
 * worse than no link) — rendering that as a dead `href="#"` anchor made
 * every un-linked resource look broken, so this makes the distinction
 * visible instead of clickable-but-does-nothing.
 */
export default function ResourceLink({ resource, className = 'text-xs' }) {
  const label = resource?.title || resource?.name || 'Resource';

  if (resource?.url) {
    return (
      <a
        href={resource.url}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 text-secondary hover:text-brand-500 transition-colors ${className}`}
      >
        <span>🔗</span>
        <span className="truncate">{label}</span>
      </a>
    );
  }

  return (
    <div
      title="No verified link found for this resource"
      className={`flex items-center gap-2 text-muted cursor-not-allowed ${className}`}
    >
      <span>🚫</span>
      <span className="truncate">{label}</span>
    </div>
  );
}
