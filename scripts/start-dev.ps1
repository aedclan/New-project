$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Get-Command node -ErrorAction SilentlyContinue) {
  $node = "node"
} elseif (Test-Path $bundledNode) {
  $node = $bundledNode
} else {
  throw "Node.js was not found. Install Node.js or run this project inside the Codex desktop environment."
}

Set-Location $projectRoot
& $node "scripts/dev-server.mjs"
