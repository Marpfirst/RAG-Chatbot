export default function Loading() {
  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--text-main)', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>Memuat data...</p>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
