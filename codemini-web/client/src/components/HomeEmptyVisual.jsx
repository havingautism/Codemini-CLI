import { useEffect, useState } from "react";
import { pickHomeEmptyVisual } from "../lib/home-empty-visuals.js";
import { HomeLottie } from "./HomeLottie.jsx";

function PrintingPress() {
  return (
    <div className="codemini-home-visual codemini-press" aria-hidden="true">
      <div className="sheet" />
      <div className="roll" />
      <div className="sheet" />
      <div className="roll" />
      <div className="sheet" />
      <div className="roll" />
      <div className="sheet" />
      <div className="sheet" />
      <div className="sheet" />
      <div className="sheet" />
      <div className="sheet" />
      <div className="roll" />
    </div>
  );
}

export function HomeEmptyVisual({ mode, children }) {
  const [visual, setVisual] = useState(() => pickHomeEmptyVisual(mode));

  useEffect(() => {
    setVisual(pickHomeEmptyVisual(mode));
  }, [mode]);

  return (
    <div
      className="codemini-home-empty-stage"
      data-visual={visual.id}
      data-visual-type={visual.type}
    >
      <div className="codemini-home-empty-glow" aria-hidden="true" />
      <div className="codemini-home-empty-media">
        {visual.type === "css" && visual.id === "printing-press" ? (
          <div className="codemini-home-empty-press">
            <PrintingPress />
          </div>
        ) : visual.type === "lottie" ? (
          <div className="codemini-home-lottie-frame">
            <HomeLottie src={visual.src} className="codemini-home-lottie-fill" />
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="codemini-home-empty-caption">{children}</div>
      ) : null}
    </div>
  );
}
