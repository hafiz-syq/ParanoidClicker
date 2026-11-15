# Sampel piksel screenshot nyata — bukti bahwa yang TERLIHAT di layar sama dengan yang
# ditulis di CSS. Dipakai untuk gerbang A1/C6.
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [int]$Row = 130
)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($Path)
Write-Output ("berkas=$Path ukuran=$($bmp.Width)x$($bmp.Height)")
$px = $bmp.GetPixel(5,5)
Write-Output ("(5,5) = rgb({0},{1},{2})  #{3:X2}{4:X2}{5:X2}" -f $px.R,$px.G,$px.B,$px.R,$px.G,$px.B)
# jejak horizontal pada satu baris: tampilkan warna yang BERUBAH saja, supaya border
# dan isi panel kelihatan sebagai angka, bukan sebagai kesan.
$y = $Row
$prev = $null
for ($x = 0; $x -lt [Math]::Min($bmp.Width, 200); $x++) {
  $p = $bmp.GetPixel($x,$y)
  $k = "{0},{1},{2}" -f $p.R,$p.G,$p.B
  if ($k -ne $prev) {
    Write-Output ("y=$y x=$x -> rgb($k)  #{0:X2}{1:X2}{2:X2}" -f $p.R,$p.G,$p.B)
    $prev = $k
  }
}
$bmp.Dispose()
