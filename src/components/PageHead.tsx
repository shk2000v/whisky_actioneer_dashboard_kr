/** Page title (focus target after navigation) plus page actions. */
export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1 tabIndex={-1}>{title}</h1>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
