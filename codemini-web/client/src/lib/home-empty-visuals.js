const DARK_DECO_VISUALS = [
  {
    type: "image",
    id: "dark-deco-boulevard",
    src: "/images/home/dark-deco-boulevard.webp",
  },
  {
    type: "image",
    id: "dark-deco-bar",
    src: "/images/home/dark-deco-bar.webp",
  },
  {
    type: "image",
    id: "dark-deco-lounge",
    src: "/images/home/dark-deco-lounge.webp",
  },
];

export const HOME_EMPTY_VISUAL_POOLS = {
  general: DARK_DECO_VISUALS,
  project: DARK_DECO_VISUALS,
};

export function pickHomeEmptyVisual(mode, rng = Math.random) {
  const pool =
    HOME_EMPTY_VISUAL_POOLS[mode] || HOME_EMPTY_VISUAL_POOLS.general;
  const index = Math.min(
    pool.length - 1,
    Math.floor(Number(rng()) * pool.length),
  );
  return pool[index];
}
