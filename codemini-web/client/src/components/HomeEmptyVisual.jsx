import { useEffect, useRef, useState } from "react";
import { pickHomeEmptyVisual } from "../lib/home-empty-visuals.js";

function paintLightStrips(canvas, palette, time = 0) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);

  const isDark = document.documentElement.dataset.theme === "dark";
  const colors = palette[isDark ? "dark" : "light"];

  colors.forEach((color, index) => {
    const y = height * (0.16 + index * 0.125);
    const bottom = height * (0.9 + index * 0.012);
    const path = new Path2D();
    path.moveTo(-width * 0.06, y);
    path.bezierCurveTo(width * 0.2, y, width * 0.27, bottom, width * 0.5, bottom);
    path.bezierCurveTo(width * 0.73, bottom, width * 0.8, y, width * 1.06, y);

    context.setLineDash([]);
    context.strokeStyle = color;
    context.globalAlpha = isDark ? 0.18 : 0.13;
    context.lineWidth = 1.2;
    context.stroke(path);

    context.setLineDash([Math.max(80, width * 0.16), Math.max(180, width * 0.38)]);
    context.lineDashOffset = (index % 2 ? 1 : -1) * (time * 0.035 + index * width * 0.11);
    context.globalAlpha = isDark ? 0.9 : 0.72;
    context.lineWidth = isDark ? 2 : 1.6;
    context.shadowColor = color;
    context.shadowBlur = isDark ? 13 : 9;
    context.stroke(path);
    context.shadowBlur = 0;
  });

  context.globalAlpha = 1;
  context.setLineDash([]);
}

function GeminiLightStrips({ palette }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const render = (time = 0) => {
      paintLightStrips(canvas, palette, time);
      if (!motion.matches) frame = window.requestAnimationFrame(render);
    };
    const restart = () => {
      window.cancelAnimationFrame(frame);
      render();
    };
    const resizeObserver = new ResizeObserver(restart);
    const themeObserver = new MutationObserver(restart);

    resizeObserver.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    motion.addEventListener("change", restart);
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener("change", restart);
    };
  }, [palette]);

  return <canvas ref={canvasRef} className="codemini-gemini-canvas" aria-hidden="true" />;
}

export function HomeEmptyVisual({ mode, children }) {
  const [palette, setPalette] = useState(() => pickHomeEmptyVisual(mode));

  useEffect(() => {
    setPalette(pickHomeEmptyVisual(mode));
  }, [mode]);

  return (
    <div className="codemini-home-empty-stage" data-palette={palette.id}>
      <div className="codemini-home-empty-media">
        <GeminiLightStrips palette={palette} />
      </div>
      {children ? <div className="codemini-home-empty-caption">{children}</div> : null}
    </div>
  );
}
