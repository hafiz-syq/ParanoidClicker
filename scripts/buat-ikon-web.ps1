# Bangun ikon PERMUKAAN WEB (favicon/tab) dari mark baru yang ber-alpha.
#
# Kenapa berkas ini terpisah dari scripts/buat-ikon.ps1 dan bukan cuma parameter baru di
# dalamnya — dua hal di situ salah untuk sumber ini, dan keduanya tidak memberi error:
#
# 1. buat-ikon.ps1:101 memaksa `db[j+3] = 255` sesudah komposit, jadi hasilnya selalu
#    kotak pekat. Untuk ikon aplikasi itu memang yang diinginkan. Untuk web, keputusan
#    latar harus sadar, bukan efek samping.
# 2. buat-ikon.ps1:99 kompositnya SCREEN (aditif). SCREEN MEMBUANG piksel gelap: layer
#    hitam di atas latar apa pun tetap latar itu. Sumber ini bukan putih-di-atas-hitam
#    seperti Paranoid.jpg — diukur (lihat -Ukur): 627.094 piksel ber-alpha>0 punya
#    maxRGB<128, yaitu bayangan lunak yang sengaja dibakar di sekitar glyph. SCREEN akan
#    menghapus bayangan itu tanpa suara. Yang jujur di sini SRC-OVER biasa:
#    hasil = rgb*alpha + latar*(1-alpha).
#
# Bounding box diambil dari sumber, dan dari DUA definisi "bukan latar" yang hasilnya
# BEDA di berkas ini: max(R,G,B) > ambang (konvensi buat-ikon.ps1 + README) memberi
# x 25..3061, sedangkan max(R,G,B)*alpha/255 > ambang — cahaya yang benar-benar sampai ke
# kanvas sesudah SRC-OVER — berhenti di x 2734. Ekornya putih dengan alpha <= 8, jadi ia
# nyata di box rgb tapi tidak terlihat. Yang dipakai untuk menengahkan dan men-skala adalah
# box premultiplied; keduanya tetap dilaporkan supaya bedanya bisa diperiksa orang lain.
# Catatan: margin sumber memang tidak simetris (kiri 25 vs kanan 202 pada box rgb), jadi
# "ditengahkan lewat box rgb" dan "ditengahkan lewat kanvas" adalah tiga posisi yang berbeda.
#
# Gerbang di bawah membaca ulang BERKAS dari disk, bukan buffer RAM, dan menghitung
# piksel terang + piksel "sendirian": angka itu yang dipakai untuk memilih $InkFrac, jadi
# "cukup terbaca di 16 px" adalah ukuran, bukan perasaan.
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$OutDir,
  # Daftar, bukan array: `powershell -File` mengirim tiap argumen sebagai STRING, dan
  # konversi string -> [double[]] gagal ("Input string was not in a correct format")
  # padahal [int[]] untuk "16,32" lolos. Dipecah di sini supaya keduanya seragam.
  [string]$Sizes = "16,32",
  [string]$InkFrac = "0.86",
  [string]$Bg = "0b0b0f",
  [int]$Ambang = 48,
  # -Ukur: jangan tulis apa pun, laporkan geometry + alpha + tinta sumber saja.
  [switch]$Ukur
)

$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class IkonWeb {
  static int[] Rgb(string hex) {
    return new[] {
      Convert.ToInt32(hex.Substring(0, 2), 16),
      Convert.ToInt32(hex.Substring(2, 2), 16),
      Convert.ToInt32(hex.Substring(4, 2), 16)
    };
  }

  // Satu lintasan LockBits atas sumber. DUA bounding box dilaporkan, karena jawabannya
  // berbeda dan yang dipakai untuk menengahkan harus yang premultiplied:
  //   rgb    = max(R,G,B) > ambang       -> sama dengan konvensi buat-ikon.ps1/README
  //   tinta  = max(R,G,B)*alpha/255 > ambang -> seberapa banyak cahaya yang benar-benar
  //          sampai ke kanvas sesudah SRC-OVER. Ekor kanan/bawah mark ini putih dengan
  //          alpha <= 8: ikut box rgb, glyph terlihat bergeser ke kiri-atas.
  static void UkurSumber(Bitmap src32, int ambang, out int tx0, out int ty0, out int tx1, out int ty1,
                         out long nTinta, out int rx0, out int ry0, out int rx1, out int ry1, out long nRgb,
                         out long nAlpha, out long nGelap, out long maxDeltaKanal, out long alphaMin, out long alphaMax) {
    int W = src32.Width, H = src32.Height;
    tx0 = W; ty0 = H; tx1 = -1; ty1 = -1; nTinta = 0;
    rx0 = W; ry0 = H; rx1 = -1; ry1 = -1; nRgb = 0;
    nAlpha = 0; nGelap = 0; maxDeltaKanal = 0; alphaMin = 255; alphaMax = 0;
    var r = new Rectangle(0, 0, W, H);
    BitmapData d = src32.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] b = new byte[d.Stride * H];
    Marshal.Copy(d.Scan0, b, 0, b.Length);
    src32.UnlockBits(d);
    for (int y = 0; y < H; y++) {
      int row = y * d.Stride;
      for (int x = 0; x < W; x++) {
        int p = row + x * 4;
        int bl = b[p], g = b[p + 1], rr = b[p + 2], a = b[p + 3];
        int mx = Math.Max(Math.Max(rr, g), bl);
        int mn = Math.Min(Math.Min(rr, g), bl);
        if (a < alphaMin) alphaMin = a;
        if (a > alphaMax) alphaMax = a;
        if (a > 0) {
          nAlpha++;
          long dl = mx - mn; if (dl > maxDeltaKanal) maxDeltaKanal = dl;
          if (mx < 128) nGelap++;
        }
        if (mx > ambang) {
          nRgb++;
          if (x < rx0) rx0 = x; if (x > rx1) rx1 = x;
          if (y < ry0) ry0 = y; if (y > ry1) ry1 = y;
        }
        if (mx * a / 255 > ambang) {
          nTinta++;
          if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
          if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
        }
      }
    }
  }

  public static string Ukur(string srcPath, int ambang) {
    using (var raw = new Bitmap(srcPath)) {
      var src32 = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
      using (var g0 = Graphics.FromImage(src32)) {
        g0.DrawImage(raw, new Rectangle(0, 0, raw.Width, raw.Height), new Rectangle(0, 0, raw.Width, raw.Height), GraphicsUnit.Pixel);
      }
      int tx0, ty0, tx1, ty1, rx0, ry0, rx1, ry1;
      long nTinta, nRgb, nAlpha, nGelap, maxDelta, aMin, aMax;
      UkurSumber(src32, ambang, out tx0, out ty0, out tx1, out ty1, out nTinta,
                 out rx0, out ry0, out rx1, out ry1, out nRgb, out nAlpha, out nGelap, out maxDelta, out aMin, out aMax);
      var sb = new StringBuilder();
      sb.AppendLine("sumber " + srcPath + " " + raw.Width + "x" + raw.Height + " format=" + raw.PixelFormat);
      sb.AppendLine("rgb(> " + ambang + ")   x " + rx0 + ".." + rx1 + " y " + ry0 + ".." + ry1
        + " -> " + (rx1 - rx0 + 1) + "x" + (ry1 - ry0 + 1) + " n=" + nRgb
        + " tengah x=" + Math.Round((rx0 + rx1) / 2.0, 1) + " y=" + Math.Round((ry0 + ry1) / 2.0, 1)
        + " margin kiri=" + rx0 + " kanan=" + (raw.Width - 1 - rx1) + " atas=" + ry0 + " bawah=" + (raw.Height - 1 - ry1));
      sb.AppendLine("tinta(> " + ambang + ") x " + tx0 + ".." + tx1 + " y " + ty0 + ".." + ty1
        + " -> " + (tx1 - tx0 + 1) + "x" + (ty1 - ty0 + 1) + " n=" + nTinta
        + " tengah x=" + Math.Round((tx0 + tx1) / 2.0, 1) + " y=" + Math.Round((ty0 + ty1) / 2.0, 1)
        + " margin kiri=" + tx0 + " kanan=" + (raw.Width - 1 - tx1) + " atas=" + ty0 + " bawah=" + (raw.Height - 1 - ty1));
      sb.AppendLine("alpha>0 n=" + nAlpha + " alpha[min,max]=" + aMin + "," + aMax
        + "  alpha>0 & maxKanal<128 (bagian gelap/bayangan) = " + nGelap + "  maxDeltaKanal = " + maxDelta);
      // Mengapa menengahkan pakai box premultiplied, bukan box rgb, harus jadi ANGKA, bukan
      // rasa: berapa piksel yang membuat box rgb menjulur, dan seberapa besar alpha mereka.
      sb.AppendLine(Ekor(src32, ambang, tx0, ty0, tx1, ty1, rx0, ry0, rx1, ry1));
      src32.Dispose();
      return sb.ToString();
    }
  }

  static string Ekor(Bitmap src32, int ambang, int tx0, int ty0, int tx1, int ty1,
                     int rx0, int ry0, int rx1, int ry1) {
    int W = src32.Width, H = src32.Height;
    var r = new Rectangle(0, 0, W, H);
    BitmapData d = src32.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] b = new byte[d.Stride * H];
    Marshal.Copy(d.Scan0, b, 0, b.Length);
    src32.UnlockBits(d);
    long kN = 0, kB = 0, kInti = 0, kAMax = 0, kAMaks = 0, sumInti = 0;
    for (int y = 0; y < H; y++) {
      int row = y * d.Stride;
      for (int x = 0; x < W; x++) {
        int p = row + x * 4;
        int bl = b[p], g = b[p + 1], rr = b[p + 2], a = b[p + 3];
        int mx = Math.Max(Math.Max(rr, g), bl);
        if (mx <= ambang) continue;
        if (x > tx1 && x <= rx1) { kN++; if (a > kAMax) kAMax = a; }
        else if (y > ty1 && y <= ry1) { kB++; if (a > kAMaks) kAMaks = a; }
        else if (x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1) { kInti++; sumInti += (long)mx * a; }
      }
    }
    double rataInti = kInti > 0 ? (double)sumInti / kInti / 255.0 : 0.0;
    return "ekor rgb>tinta: kanan x " + (tx1 + 1) + ".." + rx1 + " = " + kN + " piksel (alpha[max]=" + kAMax + ")"
      + " | bawah y " + (ty1 + 1) + ".." + ry1 + " = " + kB + " piksel (alpha[max]=" + kAMaks + ")"
      + " | inti " + kInti + " piksel, maxRGB*alpha/255 rata-rata = " + rataInti.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
  }

  public static string Buat(string srcPath, string outPath, int size, double inkFrac, string bgHex, int ambang) {
    int[] bg = Rgb(bgHex);
    using (var raw = new Bitmap(srcPath)) {
      var src32 = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
      using (var g0 = Graphics.FromImage(src32)) {
        g0.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g0.PixelOffsetMode = PixelOffsetMode.Half;
        g0.DrawImage(raw, new Rectangle(0, 0, raw.Width, raw.Height), new Rectangle(0, 0, raw.Width, raw.Height), GraphicsUnit.Pixel);
      }
      int tx0, ty0, tx1, ty1, rx0, ry0, rx1, ry1;
      long nTinta, nRgb, nAlpha, nGelap, maxDelta, aMin, aMax;
      UkurSumber(src32, ambang, out tx0, out ty0, out tx1, out ty1, out nTinta,
                 out rx0, out ry0, out rx1, out ry1, out nRgb, out nAlpha, out nGelap, out maxDelta, out aMin, out aMax);
      if (nTinta == 0) throw new Exception("sumber tidak punya tinta premultiplied > " + ambang + ": " + srcPath);
      int inkW = tx1 - tx0 + 1, inkH = ty1 - ty0 + 1;

      double s = (inkFrac * size) / (double)inkH;
      float draw = (float)(src32.Width * s);
      // Pusatkan box tinta premultiplied di tengah kanvas tujuan; bayangan ikut bergeser
      // apa adanya, karena offset bayangan terhadap glyph adalah bagian dari desain sumber.
      float ox = (float)(size / 2.0 - ((tx0 + tx1) / 2.0) * s);
      float oy = (float)(size / 2.0 - ((ty0 + ty1) / 2.0) * s);

      // Gate pemotongan: box premultiplied TIDAK sama dengan isi kanvas. Ujung runcing
      // glyph (atas y 23..83, bawah 3103..3240) ada di luar box itu dengan alpha kecil;
      // kalau kanvas sumber melebar keluar ikon, yang terpotong justru ciri marknya.
      if (ox < -0.5f || oy < -0.5f || ox + draw > size + 0.5f || oy + draw > size + 0.5f) {
        throw new Exception(string.Format(System.Globalization.CultureInfo.InvariantCulture,
          "kanvas sumber terpotong di {0}: draw={1:F2} offset=({2:F2},{3:F2}) untuk ikon {4} px pada inkFrac={5:F3} (maks {6:F3})",
          outPath, draw, ox, oy, size, inkFrac, (inkH / (double)src32.Width)));
      }

      var layer = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      using (var gl = Graphics.FromImage(layer)) {
        gl.Clear(Color.Transparent);
        gl.InterpolationMode = InterpolationMode.HighQualityBicubic;
        gl.PixelOffsetMode = PixelOffsetMode.Half;
        gl.SmoothingMode = SmoothingMode.HighQuality;
        gl.DrawImage(src32, new RectangleF(ox, oy, draw, draw),
                     new RectangleF(0, 0, src32.Width, src32.Height), GraphicsUnit.Pixel);
      }

      var dst = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      var r = new Rectangle(0, 0, size, size);
      BitmapData ld = layer.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      BitmapData dd = dst.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      byte[] lb = new byte[ld.Stride * size];
      byte[] db = new byte[dd.Stride * size];
      Marshal.Copy(ld.Scan0, lb, 0, lb.Length);
      Marshal.Copy(dd.Scan0, db, 0, db.Length);
      for (int y = 0; y < size; y++) {
        for (int x = 0; x < size; x++) {
          int i = y * ld.Stride + x * 4;
          int j = y * dd.Stride + x * 4;
          double a = lb[i + 3] / 255.0;
          for (int c = 0; c < 3; c++) {
            // SRC-OVER, bukan SCREEN: piksel gelap sumber harus MENGELAPKAN latar, bukan hilang.
            db[j + c] = (byte)Math.Round(lb[i + 2 - c] * a + bg[2 - c] * (1 - a));
          }
          db[j + 3] = 255;
        }
      }
      // Arah Marshal.Copy ditentukan urutan argumennya; tanpa baris ini kompositnya hanya
      // ada di array managed dan UnlockBits membuangnya tanpa error (bug yang dicatat
      // scripts/buat-ikon.ps1:104-109).
      Marshal.Copy(db, 0, dd.Scan0, db.Length);
      dst.UnlockBits(dd);
      layer.UnlockBits(ld);

      dst.Save(outPath, ImageFormat.Png);
      layer.Dispose(); dst.Dispose(); src32.Dispose();

      // Gerbang: yang diperiksa berkas di disk, bukan buffer RAM. pxTerang = maxKanal >
      // ambang; sendiri = piksel terang yang keempat tetangganya gelap — penanda stroke
      // yang putus jadi bintik, dan itu yang membedakan "kecil" dari "tidak terbaca".
      int terang = 0, sendiri = 0, alphaMin2 = 255, alphaMax2 = 0;
      int[] cmin = new int[] { 255, 255, 255 }, cmax = new int[] { 0, 0, 0 };
      using (var back = new Bitmap(outPath)) {
        var rr = new Rectangle(0, 0, back.Width, back.Height);
        BitmapData bd = back.LockBits(rr, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int W = back.Width, H = back.Height;
        byte[] pb = new byte[bd.Stride * H];
        Marshal.Copy(bd.Scan0, pb, 0, pb.Length);
        back.UnlockBits(bd);
        var lit = new bool[W * H];
        for (int y = 0; y < H; y++) {
          for (int x = 0; x < W; x++) {
            int p = y * bd.Stride + x * 4;
            int mx = Math.Max(pb[p], Math.Max(pb[p + 1], pb[p + 2]));
            for (int c = 0; c < 3; c++) {
              int v = pb[p + 2 - c];
              if (v < cmin[c]) cmin[c] = v;
              if (v > cmax[c]) cmax[c] = v;
            }
            if (pb[p + 3] < alphaMin2) alphaMin2 = pb[p + 3];
            if (pb[p + 3] > alphaMax2) alphaMax2 = pb[p + 3];
            if (mx > ambang) { terang++; lit[y * W + x] = true; }
          }
        }
        for (int y = 0; y < H; y++) {
          for (int x = 0; x < W; x++) {
            if (!lit[y * W + x]) continue;
            bool up = y > 0 && lit[(y - 1) * W + x];
            bool dn = y < H - 1 && lit[(y + 1) * W + x];
            bool lf = x > 0 && lit[y * W + x - 1];
            bool rt = x < W - 1 && lit[y * W + x + 1];
            if (!up && !dn && !lf && !rt) sendiri++;
          }
        }
      }
      if (terang == 0) throw new Exception("ikon rata: " + outPath + " tidak punya satu pun piksel > " + ambang);
      return string.Format(System.Globalization.CultureInfo.InvariantCulture,
        "{0} {1}x{2} inkFrac={3:F2} tintaPremultiplied={4}x{5} (x {6}..{7} y {8}..{9}) rgbBox={10}x{11} scale={12:F5} digambar={13:F2}px offset=({14:F2},{15:F2}) pxTerang={16} sendiri={17} R={18}..{19} G={20}..{21} B={22}..{23} a={24}..{25}",
        System.IO.Path.GetFileName(outPath), size, size, inkFrac, inkW, inkH, tx0, tx1, ty0, ty1,
        rx1 - rx0 + 1, ry1 - ry0 + 1, s, draw, ox, oy, terang, sendiri,
        cmin[0], cmax[0], cmin[1], cmax[1], cmin[2], cmax[2], alphaMin2, alphaMax2);
    }
  }
}
'@

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $code -ReferencedAssemblies @('mscorlib', 'System', 'System.Drawing')

if ($Ukur) {
  [IkonWeb]::Ukur($Src, $Ambang)
  return
}

$ukuran = $Sizes.Split(',') | ForEach-Object { [int]$_ }
$frak = $InkFrac.Split(',')
foreach ($size in $ukuran) {
  foreach ($tok in $frak) {
    $f = [double]::Parse($tok, [System.Globalization.CultureInfo]::InvariantCulture)
    $nama = if ($frak.Count -gt 1) { "favicon-$size-$($tok.Replace('.', '-')).png" } else { "favicon-$size.png" }
    [IkonWeb]::Buat($Src, (Join-Path $OutDir $nama), $size, $f, $Bg, $Ambang)
  }
}
