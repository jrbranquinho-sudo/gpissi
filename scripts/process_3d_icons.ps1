Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\Junior\.gemini\antigravity-ide\brain\6f599404-db8f-4bf6-b5ea-2cebfb7b3a6a\gpissi_3d_icon_1790346501277.jpg"
$destDir = "c:\projetos\gpissi\public\images"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source image not found: $sourcePath"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($sourcePath)

# Copy master image as PNG
$srcImg.Save((Join-Path $destDir "icon-3d-master.png"), [System.Drawing.Imaging.ImageFormat]::Png)

function Resize-Icon {
    param (
        [int]$Size,
        [string]$Filename,
        [bool]$Maskable = $false
    )

    $destPath = Join-Path $destDir $Filename
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    if ($Maskable) {
        # Fill background with dark matte color from icon edge
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 12, 13, 16))
        $g.FillRectangle($brush, 0, 0, $Size, $Size)
        $brush.Dispose()

        # Place icon inside 82% safe zone so it doesn't get clipped by circular Android launcher
        $innerSize = [int]($Size * 0.82)
        $offset = [int](($Size - $innerSize) / 2)
        $destRect = New-Object System.Drawing.Rectangle $offset, $offset, $innerSize, $innerSize
        $g.DrawImage($srcImg, $destRect, 0, 0, $srcImg.Width, $srcImg.Height, [System.Drawing.GraphicsUnit]::Pixel)
    } else {
        # Full bleed standard icon
        $destRect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
        $g.DrawImage($srcImg, $destRect, 0, 0, $srcImg.Width, $srcImg.Height, [System.Drawing.GraphicsUnit]::Pixel)
    }

    $g.Dispose()
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Generated 3D Icon: $Filename ($Size x $Size)"
}

# iOS Apple Touch Icon (180x180)
Resize-Icon -Size 180 -Filename "apple-touch-icon.png" -Maskable $false

# Android Standard & High-Res
Resize-Icon -Size 192 -Filename "icon-192.png" -Maskable $false
Resize-Icon -Size 512 -Filename "icon-512.png" -Maskable $false

# Android Adaptive Maskable Icon
Resize-Icon -Size 512 -Filename "icon-maskable-512.png" -Maskable $true

# Favicons
Resize-Icon -Size 32 -Filename "favicon-32x32.png" -Maskable $false
Resize-Icon -Size 16 -Filename "favicon-16x16.png" -Maskable $false

$srcImg.Dispose()
Write-Output "All 3D icons processed successfully!"
