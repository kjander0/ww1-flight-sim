[CmdletBinding()]
param(
  [ValidatePattern('^[0-9A-Za-z][0-9A-Za-z._-]*$')]
  [string]$Version = 'dev'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $projectDirectory 'dist\client'
$releaseDirectory = Join-Path $projectDirectory 'releases'
$stagingDirectory = Join-Path $releaseDirectory 'itch'
$archivePath = Join-Path $releaseDirectory "super-flight-$Version-itch.zip"

Push-Location $projectDirectory
try {
  $previousItchBuild = $env:ITCH_BUILD
  $env:ITCH_BUILD = '1'
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "The static production build failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    $env:ITCH_BUILD = $previousItchBuild
  }

  $indexPath = Join-Path $buildDirectory 'index.html'
  if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    throw "The static build did not produce dist/client/index.html."
  }

  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

  Get-ChildItem -LiteralPath $buildDirectory -Force | Where-Object {
    $_.Name -notin @('.vite', '.assetsignore', '_headers', 'vinext-client-entry-manifest.json')
  } | Copy-Item -Destination $stagingDirectory -Recurse -Force

  $textExtensions = @('.html', '.js', '.css', '.json', '.rsc')
  Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File | Where-Object {
    $_.Extension -in $textExtensions
  } | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName)
    $rewritten = $content.Replace('"/./_next/', '"./_next/').Replace("'/./_next/", "'./_next/")
    $rewritten = $rewritten.Replace('"/_next/', '"./_next/').Replace("'/_next/", "'./_next/")
    if ($rewritten -ne $content) {
      [System.IO.File]::WriteAllText($_.FullName, $rewritten, [System.Text.UTF8Encoding]::new($false))
    }
  }

  $remainingAbsoluteAssets = Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File | Where-Object {
    $_.Extension -in $textExtensions
  } | Select-String -SimpleMatch '/_next/' | Where-Object {
    $_.Line -match '["'']/+(?:\./)?_next/'
  }
  if ($remainingAbsoluteAssets) {
    throw 'The packaged build still contains absolute /_next/ asset URLs.'
  }

  $rootBasedPreloadRuntime = Get-ChildItem -LiteralPath $stagingDirectory -Recurse -Filter '*.js' | Where-Object {
    [System.IO.File]::ReadAllText($_.FullName).Contains('return`/`+e')
  } | Select-Object -First 1
  if ($rootBasedPreloadRuntime) {
    throw 'The packaged build contains a root-based Vite preload runtime and will not work from itch.io''s nested path.'
  }

  $packageFiles = @(Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File)
  $totalBytes = ($packageFiles | Measure-Object -Property Length -Sum).Sum
  $oversizedFile = $packageFiles | Where-Object { $_.Length -gt 200MB } | Select-Object -First 1
  $longPath = $packageFiles | Where-Object {
    $_.FullName.Substring($stagingDirectory.Length + 1).Replace('\', '/').Length -gt 240
  } | Select-Object -First 1

  if ($packageFiles.Count -gt 1000) {
    throw "The package contains $($packageFiles.Count) files; itch.io allows at most 1,000."
  }
  if ($totalBytes -gt 500MB) {
    throw 'The extracted package is larger than itch.io''s 500 MB limit.'
  }
  if ($oversizedFile) {
    throw "The package contains a file larger than itch.io's 200 MB per-file limit: $($oversizedFile.Name)"
  }
  if ($longPath) {
    throw "The package contains a path longer than itch.io's 240-character limit: $($longPath.FullName)"
  }

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal

  $archive = Get-Item -LiteralPath $archivePath
  Write-Host "Itch.io release ready: $($archive.FullName)"
  Write-Host ("Archive size: {0:N2} MB" -f ($archive.Length / 1MB))
  Write-Host ("Extracted size: {0:N2} MB across {1} files" -f ($totalBytes / 1MB), $packageFiles.Count)
}
finally {
  Pop-Location
}
