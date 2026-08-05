const YOUTUBE_HOST_PATTERN = /^(?:www\.)?(?:youtube\.com|youtu\.be)$/i;

/**
 * Returns true if the URL points to a YouTube watch page or short URL.
 */
export const isYouTubeWatchUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return YOUTUBE_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
};

/**
 * Extracts the YouTube video ID from a watch URL.
 */
export const extractVideoId = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1) || undefined;
    }
    return parsed.searchParams.get("v") ?? undefined;
  } catch {
    return undefined;
  }
};
