/** True in the web test build, which ships a captured snapshot of the site as window.__WT_SNAPSHOT__. */
export const isDemo = () => typeof window !== "undefined" && "__WT_SNAPSHOT__" in window;
