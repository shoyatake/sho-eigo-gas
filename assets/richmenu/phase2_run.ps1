# sho eigo - LINE Rich Menu Registration (PHASE 2)
# Windows PowerShell 5.1+ / curl.exe (Win10/11 built-in)

$ErrorActionPreference = 'Stop'

if (-not $env:CHANNEL_TOKEN) {
    Write-Host "ERROR: `$env:CHANNEL_TOKEN is not set." -ForegroundColor Red
    Write-Host "Run this first:" -ForegroundColor Yellow
    Write-Host "  `$env:CHANNEL_TOKEN = 'your_long_lived_channel_access_token'"
    exit 1
}

$token = $env:CHANNEL_TOKEN
Write-Host "TOKEN length: $($token.Length) (expected ~170)"

Set-Location -Path $PSScriptRoot

# Required files
$required = @("menu_a.json","menu_a.png","menu_b.json","menu_b.png","menu_c.json","menu_c.png")
foreach ($f in $required) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: missing file: $f" -ForegroundColor Red
        exit 1
    }
}

function Register-Menu {
    param([string]$JsonFile, [string]$ImgFile, [string]$Label)

    Write-Host ""
    Write-Host "=== Menu $Label ===" -ForegroundColor Cyan

    # Create rich menu
    $resp = & curl.exe -s -X POST "https://api.line.me/v2/bot/richmenu" `
        -H "Authorization: Bearer $token" `
        -H "Content-Type: application/json" `
        --data-binary "@$JsonFile"
    Write-Host "  create response: $resp"

    try {
        $id = ($resp | ConvertFrom-Json).richMenuId
    } catch {
        Write-Host "  ERROR: failed to parse response for $Label" -ForegroundColor Red
        exit 1
    }
    if (-not $id) {
        Write-Host "  ERROR: no richMenuId returned for $Label" -ForegroundColor Red
        exit 1
    }
    Write-Host "  richMenuId: $id" -ForegroundColor Green

    # Upload image
    $uploadResp = & curl.exe -s -X POST "https://api-data.line.me/v2/bot/richmenu/$id/content" `
        -H "Authorization: Bearer $token" `
        -H "Content-Type: image/png" `
        --data-binary "@$ImgFile"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: image upload failed for $Label" -ForegroundColor Red
        exit 1
    }
    Write-Host "  image upload response: $uploadResp"

    return $id
}

$RichmenuA = Register-Menu -JsonFile "menu_a.json" -ImgFile "menu_a.png" -Label "A (Lead)"
$RichmenuB = Register-Menu -JsonFile "menu_b.json" -ImgFile "menu_b.png" -Label "B (Member)"
$RichmenuC = Register-Menu -JsonFile "menu_c.json" -ImgFile "menu_c.png" -Label "C (Dormant)"

Write-Host ""
Write-Host "=== Setting Menu A as default ===" -ForegroundColor Cyan
& curl.exe -s -X POST "https://api.line.me/v2/bot/user/all/richmenu/$RichmenuA" `
    -H "Authorization: Bearer $token"
Write-Host ""
Write-Host "  default set" -ForegroundColor Green

Write-Host ""
Write-Host "=== All registered rich menus ===" -ForegroundColor Cyan
$listJson = & curl.exe -s -X GET "https://api.line.me/v2/bot/richmenu/list" `
    -H "Authorization: Bearer $token"
$listJson | ConvertFrom-Json | ConvertTo-Json -Depth 10

Write-Host ""
Write-Host "=== Default rich menu ===" -ForegroundColor Cyan
& curl.exe -s -X GET "https://api.line.me/v2/bot/user/all/richmenu" `
    -H "Authorization: Bearer $token"
Write-Host ""

Write-Host ""
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host " Done. Save these 3 UUIDs to Spreadsheet > RICHMENU sheet:" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "RICHMENU_A=$RichmenuA"
Write-Host "RICHMENU_B=$RichmenuB"
Write-Host "RICHMENU_C=$RichmenuC"
Write-Host "================================================================" -ForegroundColor Yellow
