import worldDocument from '../../../docs/worldbuilding.md?raw';

export function ArchivesPage() {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">SECTOR ARCHIVES</span>
          <h2>曙光边区档案</h2>
        </div>
        <span className="mono">2368 / ORIGINAL SECTOR</span>
      </div>
      <article className="document">
        {worldDocument
          .split('\n')
          .map((line, i) =>
            line.startsWith('# ') ? (
              <h2 key={i}>{line.slice(2)}</h2>
            ) : line.startsWith('## ') ? (
              <h3 key={i}>{line.slice(3)}</h3>
            ) : line.startsWith('### ') ? (
              <h4 key={i}>{line.slice(4)}</h4>
            ) : line.trim() ? (
              <p key={i}>{line}</p>
            ) : null,
          )}
      </article>
    </>
  );
}
