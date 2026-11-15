# Buat ikon PNG dari Paranoid.jpg tanpa ImageMagick.
#
# Mesin ini tidak punya magick/ffmpeg/cwebp, dan `convert` di PATH adalah
# C:\Windows\System32\convert.exe (utilitas disk FAT->NTFS) — memanggilnya akan mencoba
# memformat volume, jadi satu-satunya jalur yang terbukti adalah System.Drawing.
#
# Sumber: JPEG grayscale 480x480, mark putih di atas HITAM PEKAT. Menempelkan gambar itu
# apa adanya ke kanvas #0b0b0f akan menimpa latar itu dengan #000000. Karena mark-nya
# cahaya di atas hitam, komposisi yang jujur adalah SCREEN (aditif): hasil =
# 255 - (255-latar)*(255-layer)/255. Mark terlihat sama persis seperti di sumbernya,
# hanya latarnya ikut #0b0b0f.
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$OutDir,
  # Fraksi tinggi mark terhadap sisi ikon. 0 = gambar sumber mengisi penuh kanvas.
  # 0.60 dipakai untuk maskable: zona aman web.dev = lingkaran berjari-jari 40% lebar.
  [double]$MarkFracMaskable = 0.60,
  [string]$Bg = "0b0b0f"
)

$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Ikon {
  static int[] Rgb(string hex) {
    return new[] {
      Convert.ToInt32(hex.Substring(0, 2), 16),
      Convert.ToInt32(hex.Substring(2, 2), 16),
      Convert.ToInt32(hex.Substring(4, 2), 16)
    };
  }

  public static string Buat(string srcPath, string outPath, int size, double markFrac, string bgHex) {
    int[] bg = Rgb(bgHex);
    using (var raw = new Bitmap(srcPath)) {
      // Salin ke 32bpp supaya bisa dikunci dan di-resample tanpa Palette.
      var src32 = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
      using (var g0 = Graphics.FromImage(src32)) {
        g0.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g0.PixelOffsetMode = PixelOffsetMode.Half;
        g0.DrawImage(raw, new Rectangle(0, 0, raw.Width, raw.Height), new Rectangle(0, 0, raw.Width, raw.Height), GraphicsUnit.Pixel);
      }

      // Bounding box mark diukur dari sumbernya, bukan diketik dari laporan orang.
      // Ambang 48: di bawah itu yang tersisa adalah ringing JPEG (#020202), bukan gambar.
      int x0 = src32.Width, y0 = src32.Height, x1 = -1, y1 = -1;
      var rd = new Rectangle(0, 0, src32.Width, src32.Height);
      var lm = new BitmapData();
      lm = src32.LockBits(rd, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      byte[] sb = new byte[Math.Abs(lm.Stride) * src32.Height];
      Marshal.Copy(lm.Scan0, sb, 0, sb.Length);
      for (int y = 0; y < src32.Height; y++) {
        for (int x = 0; x < src32.Width; x++) {
          int i = y * lm.Stride + x * 4;
          // Hanya kanal warna: alpha sumber selalu 255, ikut max berarti seluruh
          // kanvas dianggap mark dan bounding box-nya jadi 480x480.
          int m = Math.Max(sb[i], Math.Max(sb[i + 1], sb[i + 2]));
          if (m > 48) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      src32.UnlockBits(lm);
      int markW = x1 - x0 + 1, markH = y1 - y0 + 1;

      double s = markFrac > 0 ? (markFrac * size) / (double)markH : (double)size / (double)src32.Width;
      int draw = (int)Math.Round(src32.Width * s);
      int off = (size - draw) / 2;

      var layer = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      using (var gl = Graphics.FromImage(layer)) {
        gl.Clear(Color.Transparent);
        gl.InterpolationMode = InterpolationMode.HighQualityBicubic;
        gl.PixelOffsetMode = PixelOffsetMode.Half;
        gl.SmoothingMode = SmoothingMode.HighQuality;
        gl.DrawImage(src32, new Rectangle(off, off, draw, draw), new Rectangle(0, 0, src32.Width, src32.Height), GraphicsUnit.Pixel);
      }

      var dst = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      var r = new Rectangle(0, 0, size, size);
      var ld = layer.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var dd = dst.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      byte[] lb = new byte[Math.Abs(ld.Stride) * size];
      byte[] db = new byte[Math.Abs(dd.Stride) * size];
      Marshal.Copy(ld.Scan0, lb, 0, lb.Length);
      Marshal.Copy(dd.Scan0, db, 0, db.Length);
      for (int y = 0; y < size; y++) {
        for (int x = 0; x < size; x++) {
          int i = y * ld.Stride + x * 4;
          int j = y * dd.Stride + x * 4;
          double a = lb[i + 3] / 255.0;                   // byte 3 = alpha (BGRA)
          for (int c = 0; c < 3; c++) {
            double light = lb[i + c] * a;                  // layer sebagai cahaya
            db[j + c] = (byte)Math.Round(255 - (255 - bg[2 - c]) * (255 - light) / 255.0);
          }
          db[j + 3] = 255;
        }
      }
      // Salin HASILnya kembali ke buffer native. Arah Marshal.Copy ditentukan urutan
      // argumennya: (Scan0 -> db) di atas itu MEMBACA, jadi tanpa baris ini seluruh
      // komposisi hanya ada di array managed dan UnlockBits membuang semuanya —
      // GDI+ tidak memberi error apa pun; enam ikon pertama yang "selesai" isinya
      // kanvas #0b0b0f rata tanpa mark.
      Marshal.Copy(db, 0, dd.Scan0, db.Length);
      dst.UnlockBits(dd);
      layer.UnlockBits(ld);

      dst.Save(outPath, ImageFormat.Png);
      layer.Dispose(); dst.Dispose(); src32.Dispose();

      // Gerbang: yang diperiksa adalah BERKAS di disk, bukan buffer di RAM. Bug yang
      // dijaga: LockBits dengan format beda dari format aktual bitmap memberi salinan,
      // tulisannya dibuang tanpa error, dan yang tersimpan kanvas rata.
      int terang = 0;
      using (var back = new Bitmap(outPath)) {
        var rr = new Rectangle(0, 0, back.Width, back.Height);
        var bd = back.LockBits(rr, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] pb = new byte[Math.Abs(bd.Stride) * back.Height];
        Marshal.Copy(bd.Scan0, pb, 0, pb.Length);
        back.UnlockBits(bd);
        for (int k = 0; k < pb.Length; k += 4) {
          if (Math.Max(pb[k], Math.Max(pb[k + 1], pb[k + 2])) > 48) terang++;
        }
      }
      if (terang == 0) throw new Exception("ikon rata: " + outPath + " tidak punya satu pun piksel >48");
      return string.Format("{0} {1}x{2} mark={3}x{4} (bbox {5}..{6} x {7}..{8}) scale={9:F4} digambar={10}px offset={11} pxTerang={12}",
        System.IO.Path.GetFileName(outPath), size, size, markW, markH, x0, x1, y0, y1, s, draw, off, terang);
    }
  }
}
'@

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$jobs = @(
  @{ f = 'paranoid-512.png';          n = 512;  m = 0 },
  @{ f = 'paranoid-192.png';          n = 192;  m = 0 },
  @{ f = 'paranoid-32.png';           n = 32;   m = 0 },
  @{ f = 'paranoid-180.png';          n = 180;  m = 0 },
  @{ f = 'paranoid-1024.png';         n = 1024; m = 0 },
  @{ f = 'paranoid-maskable-512.png'; n = 512;  m = $MarkFracMaskable }
)
foreach ($j in $jobs) {
  [Ikon]::Buat($Src, (Join-Path $OutDir $j.f), $j.n, $j.m, $Bg)
}
