$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $separator = $line.IndexOf("=")
            if ($separator -lt 1) {
                throw "Invalid .env line format."
            }

            $name = $line.Substring(0, $separator).Trim()
            $value = $line.Substring($separator + 1).Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$encryptedTokenFile = Join-Path $PSScriptRoot "..\secrets\databricks-token.dpapi"
if (Test-Path -LiteralPath $encryptedTokenFile) {
    $secureToken = Get-Content -LiteralPath $encryptedTokenFile -Raw | ConvertTo-SecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        [Environment]::SetEnvironmentVariable("DATABRICKS_TOKEN", $plainToken, "Process")
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        $secureToken.Dispose()
        Remove-Variable plainToken -ErrorAction SilentlyContinue
    }
}
