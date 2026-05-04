export function createStore(initial) {
  const subscribers = [];
  const state = { ...initial };

  return {
    get(key) {
      return key ? state[key] : { ...state };
    },

    set(updates) {
      const prev = { ...state };
      Object.assign(state, updates);
      for (const fn of subscribers) {
        try { fn(state, prev); } catch (e) { console.error('Store subscriber error:', e); }
      }
    },

    subscribe(fn) {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    }
  };
}
