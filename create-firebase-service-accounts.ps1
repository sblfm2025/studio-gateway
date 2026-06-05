param(
    [switch]$ForceNewKey
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Get-FirebaseAccessToken {
    $jsonText = & npx.cmd firebase-tools login:list --json
    if ($LASTEXITCODE -ne 0) {
        throw "Firebase CLI belum login. Jalankan npx.cmd firebase-tools login."
    }

    $login = $jsonText | ConvertFrom-Json
    $account = $login.result | Select-Object -First 1
    if (-not $account -or -not $account.tokens.access_token) {
        throw "Token Firebase CLI tidak ditemukan."
    }
    return $account.tokens.access_token
}

function Invoke-GoogleApi(
    [string]$Method,
    [string]$Uri,
    [string]$Token,
    [object]$Body = $null,
    [int[]]$AllowedStatusCodes = @(200)
) {
    $headers = @{ Authorization = "Bearer $Token" }
    $jsonBody = $null
    if ($null -ne $Body) {
        $jsonBody = $Body | ConvertTo-Json -Depth 20
    }

    try {
        if ($null -ne $Body) {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType "application/json" -Body $jsonBody
        }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
    } catch {
        $response = $_.Exception.Response
        if ($response -and $AllowedStatusCodes -contains [int]$response.StatusCode) {
            return $null
        }
        throw
    }
}

function Ensure-ServiceAccount([string]$ProjectId, [string]$AccountId, [string]$DisplayName, [string]$Token) {
    $email = "$AccountId@$ProjectId.iam.gserviceaccount.com"
    $encodedEmail = [uri]::EscapeDataString($email)
    $getUri = "https://iam.googleapis.com/v1/projects/$ProjectId/serviceAccounts/$encodedEmail"

    try {
        $existing = Invoke-GoogleApi -Method "GET" -Uri $getUri -Token $Token
        if ($existing.email) {
            Write-Host "OK  : Service account sudah ada: $($existing.email)"
            return $existing.email
        }
    } catch {
        # Lanjut create jika belum ada.
    }

    $createUri = "https://iam.googleapis.com/v1/projects/$ProjectId/serviceAccounts"
    $body = @{
        accountId = $AccountId
        serviceAccount = @{
            displayName = $DisplayName
            description = "Service account untuk RadioSBL Studio Gateway"
        }
    }

    $created = Invoke-GoogleApi -Method "POST" -Uri $createUri -Token $Token -Body $body
    Write-Host "OK  : Service account dibuat: $($created.email)"
    return $created.email
}

function Ensure-ProjectRole([string]$ProjectId, [string]$ServiceAccountEmail, [string]$Role, [string]$Token) {
    $getPolicyUri = "https://cloudresourcemanager.googleapis.com/v1/projects/$ProjectId`:getIamPolicy"
    $setPolicyUri = "https://cloudresourcemanager.googleapis.com/v1/projects/$ProjectId`:setIamPolicy"
    $member = "serviceAccount:$ServiceAccountEmail"

    $policy = Invoke-GoogleApi -Method "POST" -Uri $getPolicyUri -Token $Token -Body @{}
    if (-not $policy.bindings) {
        $policy | Add-Member -MemberType NoteProperty -Name bindings -Value @()
    }

    $bindings = @($policy.bindings)
    $binding = $bindings | Where-Object { $_.role -eq $Role } | Select-Object -First 1
    if ($binding) {
        $members = @($binding.members)
        if ($members -contains $member) {
            Write-Host "OK  : Role $Role sudah ada untuk $ServiceAccountEmail"
            return
        }
        $binding.members = @($members + $member)
    } else {
        $bindings += [pscustomobject]@{
            role = $Role
            members = @($member)
        }
        $policy.bindings = $bindings
    }

    Invoke-GoogleApi -Method "POST" -Uri $setPolicyUri -Token $Token -Body @{ policy = $policy } | Out-Null
    Write-Host "OK  : Role $Role diberikan ke $ServiceAccountEmail"
}

function Create-ServiceAccountKey([string]$ProjectId, [string]$ServiceAccountEmail, [string]$DestinationFile, [string]$Token) {
    $destinationPath = Join-Path $projectRoot $DestinationFile
    if ((Test-Path -LiteralPath $destinationPath) -and -not $ForceNewKey) {
        Write-Host "OK  : Key sudah ada, tidak dibuat ulang: $DestinationFile"
        return
    }

    $encodedEmail = [uri]::EscapeDataString($ServiceAccountEmail)
    $uri = "https://iam.googleapis.com/v1/projects/-/serviceAccounts/$encodedEmail/keys"
    $body = @{
        privateKeyType = "TYPE_GOOGLE_CREDENTIALS_FILE"
        keyAlgorithm = "KEY_ALG_RSA_2048"
    }

    $created = Invoke-GoogleApi -Method "POST" -Uri $uri -Token $Token -Body $body
    if (-not $created.privateKeyData) {
        throw "Google IAM API tidak mengembalikan privateKeyData untuk $ServiceAccountEmail"
    }

    $bytes = [Convert]::FromBase64String($created.privateKeyData)
    [IO.File]::WriteAllBytes($destinationPath, $bytes)
    Write-Host "OK  : Key disimpan ke $DestinationFile"
}

Write-Host "=== Create Firebase Service Accounts Studio Gateway ==="
Write-Host "Akun service account akan dibuat jika belum ada, lalu diberi role roles/datastore.user."

$token = Get-FirebaseAccessToken

$gatewayEmail = Ensure-ServiceAccount `
    -ProjectId "radio-sbl-overlay" `
    -AccountId "studio-gateway" `
    -DisplayName "Studio Gateway RadioBOSS" `
    -Token $token
Ensure-ProjectRole -ProjectId "radio-sbl-overlay" -ServiceAccountEmail $gatewayEmail -Role "roles/datastore.user" -Token $token
Create-ServiceAccountKey -ProjectId "radio-sbl-overlay" -ServiceAccountEmail $gatewayEmail -DestinationFile "service-account-gateway.json" -Token $token

$recordingEmail = Ensure-ServiceAccount `
    -ProjectId "overlaysbl" `
    -AccountId "studio-gateway-recording" `
    -DisplayName "Studio Gateway Recording" `
    -Token $token
Ensure-ProjectRole -ProjectId "overlaysbl" -ServiceAccountEmail $recordingEmail -Role "roles/datastore.user" -Token $token
Create-ServiceAccountKey -ProjectId "overlaysbl" -ServiceAccountEmail $recordingEmail -DestinationFile "service-account-recording.json" -Token $token

& powershell -ExecutionPolicy Bypass -File (Join-Path $projectRoot "install-firebase-credentials.ps1") `
    -GatewayServiceAccount (Join-Path $projectRoot "service-account-gateway.json") `
    -RecordingServiceAccount (Join-Path $projectRoot "service-account-recording.json")
if ($LASTEXITCODE -ne 0) {
    throw "Install credential gagal."
}

Write-Host "Selesai. Jalankan npm.cmd run verify:go-live untuk validasi."
