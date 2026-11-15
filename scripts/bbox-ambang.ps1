# Satu lintasan piksel, banyak ambang. "Bounding box mark" bergantung pada definisi
# "bukan latar": JPEG punya ringing halus (#020202) di luar gambar, jadi angka checker
# (x 112..368) dan angka ambang-0 (x 96..383) keduanya benar — yang harus dilaporkan
# adalah ambangnya, bukan hanya box-nya.
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [int[]]$Thresholds = @(0, 8, 16, 32, 48, 64, 96, 128)
)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($Path)
# Nama variabel TIDAK boleh W/H: PowerShell tidak membedakan besar-kecil, jadi $W dan $w
# (lebar mark) adalah variabel yang sama — lintasan kedua lalu memotong gambarnya sendiri.
$lebar = $bmp.Width; $tinggi = $bmp.Height
foreach ($t in $Thresholds) {
  $x0 = $lebar; $y0 = $tinggi; $x1 = -1; $y1 = -1; $n = 0
  for ($y = 0; $y -lt $tinggi; $y++) {
    for ($x = 0; $x -lt $lebar; $x++) {
      $p = $bmp.GetPixel($x, $y)
      $m = [Math]::Max([Math]::Max($p.R, $p.G), $p.B)
      if ($m -gt $t) {
        $n++
        if ($x -lt $x0) { $x0 = $x }; if ($x -gt $x1) { $x1 = $x }
        if ($y -lt $y0) { $y0 = $y }; if ($y -gt $y1) { $y1 = $y }
      }
    }
  }
  $w = $x1 - $x0 + 1; $h = $y1 - $y0 + 1
  Write-Output ("ambang >{0,3}: x {1}..{2}  y {3}..{4}  mark {5}x{6}  tengah x={7} y={8}  piksel={9}  rasio={10:N1}x{11:N1} = {12:N4}" -f `
    $t, $x0, $x1, $y0, $y1, $w, $h, [math]::Round(($x0 + $x1) / 2, 1), [math]::Round(($y0 + $y1) / 2, 1), $n, $w, $h, ($w / $h))
}
$bmp.Dispose()
