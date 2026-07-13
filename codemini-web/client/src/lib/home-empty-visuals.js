export const HOME_EMPTY_VISUAL_POOLS = {
  general: [
    { type: "css", id: "printing-press" },
    {
      type: "lottie",
      id: "celebration",
      src: "/animations/home/general/celebration.lottie",
    },
    {
      type: "lottie",
      id: "working-cat",
      src: "/animations/home/project/working-cat.lottie",
    },
    {
      type: "lottie",
      id: "loader-cat-dark",
      src: "/animations/home/general/loader-cat-dark.lottie",
    },
  ],
  project: [
    {
      type: "lottie",
      id: "working-cat",
      src: "/animations/home/project/working-cat.lottie",
    },
    {
      type: "lottie",
      id: "celebration",
      src: "/animations/home/general/celebration.lottie",
    },
    {
      type: "lottie",
      id: "loader-cat-dark",
      src: "/animations/home/general/loader-cat-dark.lottie",
    },
  ],
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
