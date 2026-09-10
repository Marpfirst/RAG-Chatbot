/** Same reasoning as app/history/loading.tsx, including the missing <Shell>. */
export default function Loading() {
  return (
    <div className="page">
      <div className="page-inner">
        <h2>Documents</h2>
        <p className="skeleton-line" style={{ width: 420 }} />
        <div className="table-card">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="skeleton-row" key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
