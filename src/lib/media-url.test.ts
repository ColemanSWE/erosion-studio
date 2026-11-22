import { describe, it, expect } from "vitest";
import { toMediaUrl, mediaUrlToPath, parseByteRange, needsCrossOrigin } from "./media-url";

describe("media URLs", () => {
  it.each([
    "/Users/me/Movies/clip.mp4",
    "/Users/me/My Videos/take #2 (final).mov",
    "/Volumes/Drive/ünïcødé/frame%20.png",
  ])("round-trips %s", (p) => {
    const url = toMediaUrl(p);
    expect(url.startsWith("media://local/")).toBe(true);
    expect(mediaUrlToPath(url)).toBe(p);
  });

  it("handles Windows paths and legacy file:// URLs", () => {
    expect(mediaUrlToPath(toMediaUrl("C:\\Users\\me\\clip.mp4"))).toBe("C:/Users/me/clip.mp4");
    expect(mediaUrlToPath(toMediaUrl("file:///Users/me/My%20Clip.mp4"))).toBe("/Users/me/My Clip.mp4");
  });

  it("passes through non-file URLs", () => {
    for (const url of ["blob:abc", "data:image/png;base64,xx", "https://x.test/a.mp4", "media://local/a"]) {
      expect(toMediaUrl(url)).toBe(url);
    }
    expect(needsCrossOrigin("blob:abc")).toBe(false);
    expect(needsCrossOrigin(toMediaUrl("/a.mp4"))).toBe(true);
  });
});

describe("parseByteRange", () => {
  it("parses open, closed and suffix ranges", () => {
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects missing or unsatisfiable ranges", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=200-", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
  });
});
