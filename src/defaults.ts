/** This package plans posts on disk. It never publishes them. */
export const POSTS_TO_NETWORK = false;

export const TOOL_NAME = "x-thread-queue";

/** twitter-text transformed URL length. Every http(s) URL weighs this much. */
export const URL_TRANSFORM_LENGTH = 23;

export const DEFAULT_LIMIT = 280;
export const DEFAULT_THRESHOLD = 0.8;
export const DEFAULT_PER_DAY = 3;
export const DEFAULT_MIN_GAP_HOURS = 4;
export const DEFAULT_DAY_START = "09:00";
export const DEFAULT_DAY_END = "21:00";
