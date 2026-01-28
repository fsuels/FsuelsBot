Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('dlm-current-logo.png')
Write-Output "Width: $($img.Width)"
Write-Output "Height: $($img.Height)"
Write-Output "PixelFormat: $($img.PixelFormat)"
$img.Dispose()
