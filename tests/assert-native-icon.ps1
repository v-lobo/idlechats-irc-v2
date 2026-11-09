param([long]$WindowHandle, [string]$OutputFile)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class IconProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@
$iconHandle = [IconProbe]::SendMessage([IntPtr]$WindowHandle, 0x007F, [IntPtr]1, [IntPtr]::Zero)
if ($iconHandle -eq [IntPtr]::Zero) { throw 'Native window has no large icon.' }
$bitmap = [System.Drawing.Icon]::FromHandle($iconHandle).ToBitmap()
try {
  $purple = 0
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $color = $bitmap.GetPixel($x, $y)
      if ($color.A -gt 200 -and [Math]::Abs($color.R - 135) -lt 12 -and [Math]::Abs($color.G - 65) -lt 12 -and [Math]::Abs($color.B - 236) -lt 12) { $purple++ }
    }
  }
  if ($purple -lt $bitmap.Width * $bitmap.Height * 0.25) { throw 'Native window did not receive the purple IdleChats icon.' }
  $bitmap.Save($OutputFile, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $bitmap.Dispose() }
