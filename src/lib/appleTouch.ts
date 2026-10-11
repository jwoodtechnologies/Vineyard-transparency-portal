/**
 * iPhone and iPad Safari draw their own full screen with a close button over the top left and the status
 * bar over a map's controls: maps there use their own full screen box instead (src/console/mapFullscreen.ts).
 * iPadOS reports itself as a Mac; its touch points give it away.
 */
export function isAppleTouch(ua: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}
