export function ThrowButton() {
  return (
    <button id="react-throw" type="button" onClick={() => { throw new Error("react 19 handler blew up"); }}>
      React 19 throw
    </button>
  );
}
