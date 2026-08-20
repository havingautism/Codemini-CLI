export function HomeEmptyVisual({ children }) {
  return (
    <div className="codemini-home-empty-stage">
      <div className="codemini-home-aurora" aria-hidden="true">
        <div className="codemini-home-aurora__wash" />
      </div>
      {children ? <div className="codemini-home-empty-caption">{children}</div> : null}
    </div>
  );
}
