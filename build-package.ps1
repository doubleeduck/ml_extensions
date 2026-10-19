[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$KeyPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,128}$')][string]$KeyId,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$OutputPath,
    [string]$Repository,
    [long]$IndexSerial = 0
)
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$resolvedKey = (Resolve-Path -LiteralPath $KeyPath).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $sourceRoot 'dist/official.mangalaunch.sources.mlsource'
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ($Repository -and $IndexSerial -lt 1) {
    throw 'When Repository is supplied, pass an increasing positive IndexSerial.'
}
# No Flutter build, npm install, tests or application/device launch here. The
# handwritten package packer uses Node built-ins only, not a Dart compiler.
& node (Join-Path $sourceRoot 'tools/pack.mjs') --key $resolvedKey --key-id $KeyId --version $Version --output $resolvedOutput
if ($LASTEXITCODE -ne 0) { throw 'Source package creation failed.' }
if ($Repository) {
    & node (Join-Path $sourceRoot 'tools/sign_repository_index.mjs') --repo $Repository --serial $IndexSerial --tag "v$Version" --package $resolvedOutput --key $resolvedKey --output ([System.IO.Path]::GetDirectoryName($resolvedOutput))
    if ($LASTEXITCODE -ne 0) { throw 'Repository index creation failed.' }
}
Write-Host "Separate source package: $resolvedOutput"
Write-Host 'Import its .public.json and .mlsource in Settings -> Extensions; approve publisher fingerprint separately.'
