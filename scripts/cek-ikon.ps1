# Diagnostic: statistik kanal sebuah PNG (R/G/B/A min-maks-rata-rata) lewat LockBits.
# Dipakai untuk membuktikan apakah ikon benar-benar berisi mark atau kanvas rata.
param([Parameter(Mandatory = $true)][string]$Path)
$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Cek {
  public static string Laporan(string path) {
    var min = new[] { 255, 255, 255, 255 };
    var max = new[] { 0, 0, 0, 0 };
    var sum = new long[] { 0, 0, 0, 0 };
    long n = 0;
    using (var bmp = new Bitmap(path)) {
      var r = new Rectangle(0, 0, bmp.Width, bmp.Height);
      var d = bmp.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      byte[] b = new byte[Math.Abs(d.Stride) * bmp.Height];
      Marshal.Copy(d.Scan0, b, 0, b.Length);
      for (int y = 0; y < bmp.Height; y++) {
        for (int x = 0; x < bmp.Width; x++) {
          int i = y * d.Stride + x * 4;
          // urutan memori = B, G, R, A
          for (int c = 0; c < 4; c++) {
            int v = b[i + c];
            if (v < min[c]) min[c] = v;
            if (v > max[c]) max[c] = v;
            sum[c] += v;
          }
          n++;
        }
      }
      bmp.UnlockBits(d);
      return string.Format("{0}x{1} piksel={2}\n  B min={3} max={4} avg={5:F1}\n  G min={6} max={7} avg={8:F1}\n  R min={9} max={10} avg={11:F1}\n  A min={12} max={13} avg={14:F1}",
        bmp.Width, bmp.Height, n,
        min[0], max[0], sum[0] / (double)n,
        min[1], max[1], sum[1] / (double)n,
        min[2], max[2], sum[2] / (double)n,
        min[3], max[3], sum[3] / (double)n);
    }
  }
}
'@
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[Cek]::Laporan($Path)
