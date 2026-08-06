const GEMINI_PALETTES = [
  {
    id: "gemini",
    light: ["#2563eb", "#4f46e5", "#9333ea", "#db2777", "#ea580c"],
    dark: ["#60a5fa", "#818cf8", "#c084fc", "#f472b6", "#fb923c"],
  },
  {
    id: "aurora",
    light: ["#0891b2", "#2563eb", "#7c3aed", "#c026d3", "#e11d48"],
    dark: ["#22d3ee", "#60a5fa", "#a78bfa", "#e879f9", "#fb7185"],
  },
  {
    id: "spectrum",
    light: ["#0284c7", "#0d9488", "#65a30d", "#ca8a04", "#dc2626"],
    dark: ["#38bdf8", "#2dd4bf", "#a3e635", "#facc15", "#fb7185"],
  },
  {
    id: "violet",
    light: ["#4338ca", "#6d28d9", "#9333ea", "#c026d3", "#e11d48"],
    dark: ["#818cf8", "#a78bfa", "#d8b4fe", "#f0abfc", "#fb7185"],
  },
];

export const HOME_EMPTY_VISUAL_POOLS = {
  general: GEMINI_PALETTES,
  project: GEMINI_PALETTES,
};

export function pickHomeEmptyVisual(mode, rng = Math.random) {
  const pool = HOME_EMPTY_VISUAL_POOLS[mode] || HOME_EMPTY_VISUAL_POOLS.general;
  return pool[Math.min(pool.length - 1, Math.floor(Number(rng()) * pool.length))];
}
