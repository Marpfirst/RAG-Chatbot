/**
 * Shown the moment History is opened, before the server responds.
 *
 * Without it, navigation blocks on the round trip and nothing at all is painted
 * for about a second. A skeleton makes the click feel answered immediately, and
 * the real table replaces it when the data lands.
 *
 * No <Shell> here. The sidebar lives in app/layout.tsx and stays mounted across
 * navigation — wrapping this fallback in its own Shell painted a second sidebar
 * beside the first for as long as the query took.
 */
export default function Loading() {
  return (
    <div className="page">
      <div className="page-inner">
        <h2>Token history</h2>
        <p className="skeleton-line" style={{ width: 320 }} />
        <div className="table-card">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="skeleton-row" key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
