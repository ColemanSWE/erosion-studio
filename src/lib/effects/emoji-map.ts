
export interface EmojiColor {
  char: string;
  r: number;
  g: number;
  b: number;
}

export class EmojiMap {
  private map: EmojiColor[] = [];
  private generated = false;

  async generatePalette(emojis: string[]): Promise<void> {
    this.map = [];
    
    // Create an off-screen canvas to measure emoji colors
    const canvas = document.createElement('canvas');
    const size = 32; // Analysis size
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      console.warn("Could not get 2D context for EmojiMap generation");
      return;
    }

    ctx.font = `${size * 0.8}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const char of emojis) {
      // Clear
      ctx.clearRect(0, 0, size, size);
      
      // Draw emoji
      ctx.fillText(char, size / 2, size / 2);
      
      // Get pixel data
      const imageData = ctx.getImageData(0, 0, size, size);
      const data = imageData.data;
      
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      
      // Calculate average color
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        // Only count pixels with some opacity
        if (a > 10) {
          totalR += data[i];
          totalG += data[i + 1];
          totalB += data[i + 2];
          count++;
        }
      }

      if (count > 0) {
        this.map.push({
          char,
          r: totalR / count,
          g: totalG / count,
          b: totalB / count
        });
      }
    }
    
    this.generated = true;
    console.log(`EmojiMap generated with ${this.map.length} emojis`);
  }

  findNearest(r: number, g: number, b: number): string {
    if (!this.generated || this.map.length === 0) {
        return "❓";
    }

    let minDist = Infinity;
    let bestChar = this.map[0].char;

    for (const item of this.map) {
      // Euclidean distance
      // We could weight this for better perceptual accuracy (e.g. human eye sensitivity)
      // but simple RGB distance is usually fast enough for real-time video
      const dr = item.r - r;
      const dg = item.g - g;
      const db = item.b - b;
      const dist = dr*dr + dg*dg + db*db;
      
      if (dist < minDist) {
        minDist = dist;
        bestChar = item.char;
      }
    }

    return bestChar;
  }
}

export const emojiMap = new EmojiMap();
