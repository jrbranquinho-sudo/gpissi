Add-Type -AssemblyName System.Drawing

$baseDir = "c:\projetos\gpissi\public\images"
$skullPath = Join-Path $baseDir "caveirasembg.png"

if (-not (Test-Path $skullPath)) {
    Write-Error "caveirasembg.png not found: $skullPath"
    exit 1
}

$skullImg = [System.Drawing.Image]::FromFile($skullPath)

function Generate-Caveira-Icon {
    param (
        [int]$Size,
        [string]$Filename,
        [bool]$IsMaskable = $false
    )

    $destPath = Join-Path $baseDir $Filename
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Background: Premium deep dark motorcycle background (#050608 to #0f131a)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 15, 19, 26),
        [System.Drawing.Color]::FromArgb(255, 5, 6, 8),
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Subtle warm ambient glow behind skull
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glowSize = [int]($Size * 0.8)
    $glowX = [int](($Size - $glowSize) / 2)
    $glowY = [int](($Size - $glowSize) / 2)
    $glowRect = New-Object System.Drawing.Rectangle $glowX, $glowY, $glowSize, $glowSize
    $glowPath.AddEllipse($glowRect)
    $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 102, 0)
    $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 5, 6, 8))
    $g.FillPath($glowBrush, $glowPath)
    $glowPath.Dispose()
    $glowBrush.Dispose()

    # Calculate centered skull dimensions preserving exact aspect ratio
    # Maskable safe factor: 0.70; Standard: 0.85
    $scaleFactor = if ($IsMaskable) { 0.72 } else { 0.86 }
    $maxH = [int]($Size * $scaleFactor)
    $ratio = $skullImg.Width / $skullImg.Height
    $skullH = $maxH
    $skullW = [int]($skullH * $ratio)
    
    $skullX = [int](($Size - $skullW) / 2)
    $skullY = [int](($Size - $skullH) / 2)

    # Subtle drop shadow
    $shadowImgAttr = New-Object System.Drawing.Imaging.ImageAttributes
    $shadowMatrix = New-Object System.Drawing.Imaging.ColorMatrix
    $shadowMatrix.Matrix00 = 0.0
    $shadowMatrix.Matrix11 = 0.0
    $shadowMatrix.Matrix22 = 0.0
    $shadowMatrix.Matrix33 = 0.7
    $shadowImgAttr.SetColorMatrix($shadowMatrix)

    $shadowRect = New-Object System.Drawing.Rectangle ($skullX + [int]($Size * 0.015)), ($skullY + [int]($Size * 0.02)), $skullW, $skullH
    $g.DrawImage($skullImg, $shadowRect, 0, 0, $skullImg.Width, $skullImg.Height, [System.Drawing.GraphicsUnit]::Pixel, $shadowImgAttr)
    $shadowImgAttr.Dispose()

    # Draw pure caveirasembg.png
    $destRect = New-Object System.Drawing.Rectangle $skullX, $skullY, $skullW, $skullH
    $g.DrawImage($skullImg, $destRect, 0, 0, $skullImg.Width, $skullImg.Height, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Created: $Filename ($Size x $Size)"
}

# 1. iOS Apple Touch Icon
Generate-Caveira-Icon -Size 180 -Filename "apple-touch-icon.png" -IsMaskable $false

# 2. Android Standard & High-Res
Generate-Caveira-Icon -Size 192 -Filename "icon-192.png" -IsMaskable $false
Generate-Caveira-Icon -Size 512 -Filename "icon-512.png" -IsMaskable $false

# 3. Android Adaptive Maskable Icon
Generate-Caveira-Icon -Size 512 -Filename "icon-maskable-512.png" -IsMaskable $true

# 4. Favicons
Generate-Caveira-Icon -Size 32 -Filename "favicon-32x32.png" -IsMaskable $false
Generate-Caveira-Icon -Size 16 -Filename "favicon-16x16.png" -IsMaskable $false

$skullImg.Dispose()
Write-Output "All icons generated with caveirasembg.png successfully!"
