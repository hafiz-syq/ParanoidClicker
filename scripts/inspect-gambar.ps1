# Fakta mentah sebuah berkas gambar, tanpa ImageMagick (di mesin ini `convert` adalah
# utilitas disk Windows, dan magick/ffmpeg/cwebp tidak terpasang).
param([Parameter(Mandatory=$true)][string]$Path)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($Path)
$pal = $bmp.Palette
Write-Output ("ukuran      = {0}x{1}" -f $bmp.Width, $bmp.Height)
Write-Output ("PixelFormat = {0}  bit={1}" -f $bmp.PixelFormat, [System.Drawing.Bitmap]::GetPixelFormatSize($bmp.PixelFormat))
Write-Output ("palette     = {0} entri, flags={1}" -f $pal.Entries.Count, $pal.Flags)
foreach ($c in @(@(0,0), @(240,240), @(240,68), @(239,67), @(112,240), @(368,240))) {
  $p = $bmp.GetPixel($c[0], $c[1])
  Write-Output ("pixel({0},{1}) = rgb({2},{3},{4})  #{5:X2}{6:X2}{7:X2}" -f $c[0],$c[1],$p.R,$p.G,$p.B,$p.R,$p.G,$p.B)
}
$x0 = $bmp.Width; $y0 = $bmp.Height; $x1 = -1; $y1 = -1; $nonhitam = 0
for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $p = $bmp.GetPixel($x, $y)
    if ($p.R -ne 0 -or $p.G -ne 0 -or $p.B -ne 0) {
      $nonhitam++
      if ($x -lt $x0) { $x0 = $x }; if ($x -gt $x1) { $x1 = $x }
      if ($y -lt $y0) { $y0 = $y }; if ($y -gt $y1) { $y1 = $y }
    }
  }
}
Write-Output ("non-hitam   = {0} piksel; bbox x {1}..{2}  y {3}..{4}  -> mark {5}x{6}, tengah x={7} y={8}" -f `
  $nonhitam, $x0, $x1, $y0, $y1, ($x1 - $x0 + 1), ($y1 - $y0 + 1), [math]::Round(($x0 + $x1) / 2, 1), [math]::Round(($y0 + $y1) / 2, 1))
$bmp.Dispose()
Write-Output ("sha256      = " + (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower())
Write-Output ("bytes       = " + (Get-Item $Path).Length)
