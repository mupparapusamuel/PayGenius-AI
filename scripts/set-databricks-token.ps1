$secretDirectory = Join-Path $PSScriptRoot "..\secrets"
$encryptedTokenFile = Join-Path $secretDirectory "databricks-token.dpapi"

New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
$secureToken = Read-Host "Enter the NEW rotated Databricks token (input is hidden)" -AsSecureString
if ($secureToken.Length -lt 1) {
    $secureToken.Dispose()
    throw "A non-empty token is required."
}

try {
    $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
    Set-Content -LiteralPath $encryptedTokenFile -Value $encryptedToken -NoNewline
}
finally {
    $secureToken.Dispose()
}

Write-Output "Token saved in a Windows DPAPI-protected file. It was not printed or added to .env."
