export function ThrowButton() {
  return (
    <button id="react-throw" type="button" onClick={() => { throw new Error("react handler blew up"); }}>
      React throw
    </button>
  );
}
