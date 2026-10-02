// Keep Crowd2's plain CSS isolated from the older parent project's Tailwind
// pipeline. Without a local config, Next.js walks upward and loads that
// unrelated PostCSS plugin set.
export default {
  plugins: {},
};
