import { useEffect, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

function readIsDark() {
  return document.documentElement.dataset.theme !== "light";
}

export function HomeLottie({ src, className }) {
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    typeof document === "undefined" ? true : readIsDark(),
  );
  const [dotLottie, setDotLottie] = useState(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(mq.matches);
    syncMotion();
    mq.addEventListener("change", syncMotion);
    return () => mq.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(readIsDark());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setFailed(false);
    setDotLottie(null);
  }, [src]);

  useEffect(() => {
    if (!dotLottie) return undefined;
    const onError = () => setFailed(true);
    dotLottie.addEventListener("loadError", onError);
    try {
      dotLottie.setBackgroundColor("#00000000");
    } catch {
      // ignore older players without the method
    }
    return () => {
      try {
        dotLottie.removeEventListener("loadError", onError);
      } catch {
        // ignore
      }
    };
  }, [dotLottie]);

  if (failed) {
    return <div className={className} aria-hidden="true" />;
  }

  return (
    <div
      className={className}
      data-home-lottie-theme={isDark ? "dark" : "light"}
      aria-hidden="true"
    >
      <DotLottieReact
        key={`${src}:${isDark ? "dark" : "light"}`}
        src={src}
        loop={!reducedMotion}
        autoplay={!reducedMotion}
        className="codemini-home-lottie-player"
        style={{ width: "100%", height: "100%" }}
        backgroundColor="#00000000"
        dotLottieRefCallback={setDotLottie}
      />
    </div>
  );
}
