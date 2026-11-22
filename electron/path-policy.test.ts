import { describe, expect, it } from "vitest";
import { PathPolicy } from "./path-policy";

// vite-plugin-electron-renderer aliases node: built-ins for the renderer, so
// load the real module (see the node:fs note in CLAUDE.md).
const path = process.getBuiltinModule("path") as typeof import("node:path");

describe("PathPolicy (posix)", () => {
  const make = () => new PathPolicy(path.posix);

  it("reads media and projects by extension, absolute paths only", () => {
    const p = make();
    expect(p.isMediaFile("/Users/me/clip.MP4")).toBe(true);
    expect(p.isMediaFile("/Volumes/ext/take #2.mov")).toBe(true);
    expect(p.isMediaFile("/Users/me/.ssh/id_rsa")).toBe(false);
    expect(p.isMediaFile("/etc/passwd")).toBe(false);
    expect(p.isMediaFile("clip.mp4")).toBe(false);
    expect(p.isMediaFile("../clip.mp4")).toBe(false);
    expect(p.isMediaFile("/a/clip.mp4\0.txt")).toBe(false);
    expect(p.isMediaFile(42)).toBe(false);
    expect(p.isProjectFile("/Users/me/projects/a.eron")).toBe(true);
    expect(p.isProjectFile("/Users/me/notes.txt")).toBe(false);
  });

  it("allows a dialog-granted write exactly once", () => {
    const p = make();
    expect(p.takeWriteGrant("/Users/me/out.mp4")).toBe(false);
    p.grantWrite("/Users/me/out.mp4");
    expect(p.takeWriteGrant("/Users/me/other.mp4")).toBe(false);
    expect(p.takeWriteGrant("/Users/me/./out.mp4")).toBe(true);
    expect(p.takeWriteGrant("/Users/me/out.mp4")).toBe(false);
  });

  it("only treats registered temp dirs and their frame files as temp", () => {
    const p = make();
    p.addTempDir("/tmp/erosion-export-abc");
    expect(p.isTempDir("/tmp/erosion-export-abc")).toBe(true);
    expect(p.isTempDir("/tmp")).toBe(false);
    expect(p.isTempDir("/Users/me")).toBe(false);
    expect(p.isTempFrame("/tmp/erosion-export-abc/frame_000001.png")).toBe(true);
    expect(p.isTempFrame("/tmp/erosion-export-abc/../../Users/me/frame_000001.png")).toBe(false);
    expect(p.isTempFrame("/tmp/erosion-export-abc/evil.sh")).toBe(false);
    expect(p.isTempFrame("/tmp/erosion-export-abc/sub/frame_000001.png")).toBe(false);
    p.removeTempDir("/tmp/erosion-export-abc");
    expect(p.isTempDir("/tmp/erosion-export-abc")).toBe(false);
    expect(p.isTempFrame("/tmp/erosion-export-abc/frame_000001.png")).toBe(false);
  });
});

describe("PathPolicy (win32)", () => {
  const make = () => new PathPolicy(path.win32);

  it("handles drive letters, separators and case", () => {
    const p = make();
    expect(p.isMediaFile("C:\\Users\\me\\clip.mp4")).toBe(true);
    expect(p.isMediaFile("D:/Videos/clip.webm")).toBe(true);
    expect(p.isMediaFile("C:\\Windows\\win.ini")).toBe(false);
    expect(p.isMediaFile("clip.mp4")).toBe(false);
    p.grantWrite("C:\\Users\\me\\Out.png");
    expect(p.takeWriteGrant("c:/users/ME/out.PNG")).toBe(true);
  });

  it("rejects traversal out of a temp dir", () => {
    const p = make();
    p.addTempDir("C:\\Temp\\erosion-export-1");
    expect(p.isTempFrame("C:/Temp/erosion-export-1/frame_000010.png")).toBe(true);
    expect(p.isTempFrame("C:\\Temp\\erosion-export-1\\..\\frame_000010.png")).toBe(false);
  });
});
