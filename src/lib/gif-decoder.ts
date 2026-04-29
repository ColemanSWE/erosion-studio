function resolveGifSrc(path: string): string {
  if (
    path.startsWith("blob:") ||
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("file://")
  ) {
    return path;
  }
  return `file://${path}`;
}

export class GifDecoder {
  private decoder: ImageDecoder;
  private frameIndex = 0;
  private _frameCount = 0;
  private _bitmap: ImageBitmap | null = null;
  private frameDurationMs = 100;
  private nextFrameAt = 0;

  private constructor(decoder: ImageDecoder, frameCount: number) {
    this.decoder = decoder;
    this._frameCount = Math.max(1, frameCount);
  }

  static async create(path: string): Promise<GifDecoder> {
    const src = resolveGifSrc(path);
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Failed to fetch GIF: ${src}`);
    // Load the full buffer so the decoder can seek to any frame (needed for looping)
    const buffer = await response.arrayBuffer();

    const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
    await decoder.tracks.ready;

    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const gif = new GifDecoder(decoder, frameCount);
    await gif.decodeFrame(0);
    gif.nextFrameAt = performance.now() + gif.frameDurationMs;
    return gif;
  }

  private async decodeFrame(index: number): Promise<void> {
    try {
      const result = await this.decoder.decode({ frameIndex: index });
      // VideoFrame.duration is in microseconds
      const durationUs = result.image.duration;
      this.frameDurationMs =
        durationUs != null && durationUs > 0
          ? Math.max(20, durationUs / 1000)
          : 100;
      const newBitmap = await createImageBitmap(result.image);
      result.image.close();
      const old = this._bitmap;
      this._bitmap = newBitmap;
      old?.close();
    } catch {
      // Keep previous bitmap on decode error
    }
  }

  get bitmap(): ImageBitmap | null {
    return this._bitmap;
  }

  get frameCount(): number {
    return this._frameCount;
  }

  /** Call on every rAF. Returns true if the displayed frame advanced. */
  async tick(now: number): Promise<boolean> {
    if (this._frameCount <= 1 || now < this.nextFrameAt) return false;
    this.frameIndex = (this.frameIndex + 1) % this._frameCount;
    await this.decodeFrame(this.frameIndex);
    this.nextFrameAt = now + this.frameDurationMs;
    return true;
  }

  dispose(): void {
    this._bitmap?.close();
    this._bitmap = null;
    try {
      this.decoder.close();
    } catch {
      // Ignore errors on cleanup
    }
  }
}
