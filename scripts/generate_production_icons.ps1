Add-Type -AssemblyName System.Drawing

$baseDir = "c:\projetos\gpissi\public\images"
$logoPath = Join-Path $baseDir "logosembg.png"
$logoImg = [System.Drawing.Image]::FromFile($logoPath)

function Generate-Final-Icon {
    param (
        [int]$Size,
        [string]$OutputPath,
        [bool]$IsMaskable = $false
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # 1. Dark sleek metallic carbon background gradient
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 18, 22, 32),
        [System.Drawing.Color]::FromArgb(255, 4, 5, 8),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
    )
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Safe factor: 0.70 for maskable (inside safe 80% circle), 0.86 for standard
    $safeFactor = if ($IsMaskable) { 0.70 } else { 0.88 }

    # 2. Orange Radial Glow Behind Emblem
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glowSize = [int]($Size * 0.75 * $safeFactor)
    $glowX = [int](($Size - $glowSize) / 2)
    $glowY = if ($IsMaskable) { [int]($Size * 0.12) } else { [int]($Size * 0.05) }
    $glowRect = New-Object System.Drawing.Rectangle $glowX, $glowY, $glowSize, $glowSize
    $glowPath.AddEllipse($glowRect)
    
    $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(100, 255, 102, 0)
    $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 4, 5, 8))
    $g.FillPath($glowBrush, $glowPath)
    $glowPath.Dispose()
    $glowBrush.Dispose()

    # 3. Emblem Dimensions
    $emblemMaxH = [int]($Size * 0.65 * $safeFactor)
    $emblemRatio = $logoImg.Width / $logoImg.Height
    $emblemH = $emblemMaxH
    $emblemW = [int]($emblemH * $emblemRatio)
    $emblemX = [int](($Size - $emblemW) / 2)
    $emblemY = if ($IsMaskable) { [int]($Size * 0.12) } else { [int]($Size * 0.06) }

    # Drop shadow for emblem
    $shadowImgAttr = New-Object System.Drawing.Imaging.ImageAttributes
    $shadowMatrix = New-Object System.Drawing.Imaging.ColorMatrix
    $shadowMatrix.Matrix00 = 0.0
    $shadowMatrix.Matrix11 = 0.0
    $shadowMatrix.Matrix22 = 0.0
    $shadowMatrix.Matrix33 = 0.75
    $shadowImgAttr.SetColorMatrix($shadowMatrix)

    $shadowRect = New-Object System.Drawing.Rectangle ($emblemX + [int]($Size * 0.012)), ($emblemY + [int]($Size * 0.018)), $emblemW, $emblemH
    $g.DrawImage($logoImg, $shadowRect, 0, 0, $logoImg.Width, $logoImg.Height, [System.Drawing.GraphicsUnit]::Pixel, $shadowImgAttr)
    $shadowImgAttr.Dispose()

    # Draw Emblem
    $emblemRect = New-Object System.Drawing.Rectangle $emblemX, $emblemY, $emblemW, $emblemH
    $g.DrawImage($logoImg, $emblemRect, 0, 0, $logoImg.Width, $logoImg.Height, [System.Drawing.GraphicsUnit]::Pixel)

    # 4. GPISSI Typography
    if ($Size -ge 120) {
        $fontFamily = [System.Drawing.FontFamily]::GenericSansSerif
        $fontSize = [single]($Size * 0.138 * $safeFactor)
        $font = [System.Drawing.Font]::new($fontFamily, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

        $textY = [single]($emblemY + $emblemH + ($Size * 0.015))
        
        $sizeGP = $g.MeasureString("GP", $font)
        $sizeISSI = $g.MeasureString("ISSI", $font)
        # Tight kerning between GP and ISSI
        $overlap = [single]($fontSize * 0.22)
        $totalTextW = $sizeGP.Width + $sizeISSI.Width - $overlap
        $startX = [single](($Size - $totalTextW) / 2)

        $blueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 176, 255))
        $orangeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 102, 0))
        $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 0, 0, 0))
        $shadowOffset = [single]([Math]::Max(1.5, $Size * 0.009))
        $gpRight = $startX + $sizeGP.Width - $overlap

        # Outer black shadow
        $g.DrawString("GP", $font, $shadowBrush, ($startX + $shadowOffset), ($textY + $shadowOffset))
        $g.DrawString("ISSI", $font, $shadowBrush, ($gpRight + $shadowOffset), ($textY + $shadowOffset))

        # Main Text
        $g.DrawString("GP", $font, $blueBrush, $startX, $textY)
        $g.DrawString("ISSI", $font, $orangeBrush, $gpRight, $textY)

        $font.Dispose()
        $blueBrush.Dispose()
        $orangeBrush.Dispose()
        $shadowBrush.Dispose()
    }

    $g.Dispose()

    # Save PNG
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Successfully generated: $OutputPath ($Size x $Size)"
}

# 1. iOS Shortcut Icon (apple-touch-icon 180x180)
Generate-Final-Icon -Size 180 -OutputPath (Join-Path $baseDir "apple-touch-icon.png") -IsMaskable $false

# 2. Android Shortcut & PWA Icons (192x192 & 512x512)
Generate-Final-Icon -Size 192 -OutputPath (Join-Path $baseDir "icon-192.png") -IsMaskable $false
Generate-Final-Icon -Size 512 -OutputPath (Join-Path $baseDir "icon-512.png") -IsMaskable $false
Generate-Final-Icon -Size 512 -OutputPath (Join-Path $baseDir "icon-maskable-512.png") -IsMaskable $true

# 3. Favicons
Generate-Final-Icon -Size 32 -OutputPath (Join-Path $baseDir "favicon-32x32.png") -IsMaskable $false
Generate-Final-Icon -Size 16 -OutputPath (Join-Path $baseDir "favicon-16x16.png") -IsMaskable $false

# Cleanup temporary test files
Remove-Item -Path (Join-Path $baseDir "test-skull-512.png") -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $baseDir "test-emblem-512.png") -ErrorAction SilentlyContinue

$logoImg.Dispose()
Write-Output "All production icons created successfully!"
