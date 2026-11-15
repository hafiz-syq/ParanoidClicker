# Satu lintasan LockBits: format, alpha, ambang bbox, statistik luminansi, sha256.
# Pola Add-Type ditiru dari scripts/buat-ikon.ps1:139 — tanpa -ReferencedAssemblies
# System.Drawing, compiler tidak melihat System.Drawing.Imaging.
param([Parameter(Mandatory=$true)][string]$Path)
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
public class Ukur {
  public static string Jalankan(string path) {
    using (var bmp = new Bitmap(path)) {
      int w = bmp.Width, h = bmp.Height;
      var fmt = bmp.PixelFormat;
      var rect = new Rectangle(0, 0, w, h);
      int[] thr = new int[] { 0, 8, 16, 32, 48, 64, 96, 128, 192, 240 };
      int[] x0 = new int[thr.Length], y0 = new int[thr.Length], x1 = new int[thr.Length], y1 = new int[thr.Length];
      long[] n = new long[thr.Length];
      for (int i = 0; i < thr.Length; i++) { x0[i] = w; y0[i] = h; x1[i] = -1; y1[i] = -1; }
      long alphaMin = 255, alphaMax = 0, alphaTrans = 0;
      long lumMin = 255, lumMax = 0, lumSum = 0;
      long[] lumHist = new long[16];
      using (Bitmap argb = bmp.Clone(rect, PixelFormat.Format32bppArgb)) {
        BitmapData data = argb.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] buf = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        argb.UnlockBits(data);
        for (int y = 0; y < h; y++) {
          int row = y * stride;
          for (int x = 0; x < w; x++) {
            int p = row + x * 4;
            int b = buf[p], g = buf[p + 1], r = buf[p + 2], a = buf[p + 3];
            int mx = Math.Max(Math.Max(r, g), b);
            for (int i = 0; i < thr.Length; i++) {
              if (mx > thr[i]) {
                n[i]++;
                if (x < x0[i]) x0[i] = x; if (x > x1[i]) x1[i] = x;
                if (y < y0[i]) y0[i] = y; if (y > y1[i]) y1[i] = y;
              }
            }
            if (a < alphaMin) alphaMin = a;
            if (a > alphaMax) alphaMax = a;
            if (a < 255) alphaTrans++;
            int lum = (int)(0.2126 * r + 0.7152 * g + 0.0722 * b);
            if (lum < lumMin) lumMin = lum;
            if (lum > lumMax) lumMax = lum;
            lumSum += lum;
            lumHist[lum >> 4]++;
          }
        }
      }
      var sb = new System.Text.StringBuilder();
      sb.AppendLine("format=" + fmt + " size=" + w + "x" + h);
      sb.AppendLine("alpha[min,max,piksel<255]=" + alphaMin + "," + alphaMax + "," + alphaTrans);
      sb.AppendLine("luminansi[min,max,mean]=" + lumMin + "," + lumMax + "," + (lumSum / ((long)w * h)));
      sb.AppendLine("hist16=" + string.Join(",", lumHist));
      for (int i = 0; i < thr.Length; i++) {
        if (n[i] == 0) { sb.AppendLine("thr>" + thr[i] + ": 0 piksel"); continue; }
        sb.AppendLine("thr>" + thr[i] + ": n=" + n[i] + " x " + x0[i] + ".." + x1[i] + " y " + y0[i] + ".." + y1[i]
          + " -> mark " + (x1[i] - x0[i] + 1) + "x" + (y1[i] - y0[i] + 1)
          + " tengah x=" + Math.Round((x0[i] + x1[i]) / 2.0, 1) + " y=" + Math.Round((y0[i] + y1[i]) / 2.0, 1)
          + " fraksi=" + Math.Round((x1[i] - x0[i] + 1) / (double)w, 4));
      }
      using (Bitmap chk = new Bitmap(path)) {
        Point[] cps = new Point[] {
          new Point(0, 0), new Point(w - 1, 0), new Point(0, h - 1), new Point(w - 1, h - 1),
          new Point(w / 2, h / 2), new Point(w / 2, (int)(h * 0.06)), new Point(w / 2, (int)(h * 0.94))
        };
        foreach (Point c in cps) {
          Color px = chk.GetPixel(c.X, c.Y);
          sb.AppendLine("pixel(" + c.X + "," + c.Y + ") = #" + px.R.ToString("X2") + px.G.ToString("X2") + px.B.ToString("X2") + " a=" + px.A);
        }
      }
      byte[] raw = System.IO.File.ReadAllBytes(path);
      sb.Append("bytes=" + raw.Length);
      return sb.ToString();
    }
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies @('mscorlib', 'System', 'System.Drawing')
[Ukur]::Jalankan($Path)
