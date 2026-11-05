$envFile = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Missing .env. Copy .env.example to .env and fill in local settings first."
}

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
