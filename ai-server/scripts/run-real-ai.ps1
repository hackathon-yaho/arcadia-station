[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8081,

    [string]$EnvFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$aiServerDirectory = (Resolve-Path (Join-Path $scriptDirectory '..')).Path
$mavenWrapper = Join-Path $aiServerDirectory 'mvnw.cmd'
$dotenvScript = Join-Path $scriptDirectory 'dotenv.ps1'
$dotenvPath = if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    Join-Path $aiServerDirectory '.env'
} elseif ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $aiServerDirectory $EnvFile
}

. $dotenvScript

if (-not (Test-Path -LiteralPath $dotenvPath)) {
    $examplePath = Join-Path $aiServerDirectory '.env.example'
    Copy-Item -LiteralPath $examplePath -Destination $dotenvPath
    Write-Host "로컬 설정 파일을 만들었습니다: $dotenvPath" -ForegroundColor Cyan
}

Import-ArcadiaDotEnv -Path $dotenvPath -Required | Out-Null

if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable(
        'GEMINI_API_KEY',
        'Process'
    ))) {
    $apiKey = Read-ArcadiaSecret -Label 'GEMINI_API_KEY'
    Set-ArcadiaDotEnvValue -Path $dotenvPath -Name 'GEMINI_API_KEY' -Value $apiKey
    [Environment]::SetEnvironmentVariable('GEMINI_API_KEY', $apiKey, 'Process')
    Write-Host '.env에 Gemini API 키를 저장했습니다. 이 파일은 Git에 포함되지 않습니다.' `
        -ForegroundColor Cyan
}

function Set-DefaultEnvironmentValue {
    param([string]$Name, [string]$Value)

    $current = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($current)) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}

Set-DefaultEnvironmentValue -Name 'AI_INTERNAL_API_KEY' -Value 'arcadia-local-shared-key'
Set-DefaultEnvironmentValue -Name 'GEMINI_TEXT_MODEL' -Value 'gemini-3.6-flash'
Set-DefaultEnvironmentValue -Name 'GEMINI_EMBEDDING_MODEL' -Value 'gemini-embedding-2'
Set-DefaultEnvironmentValue -Name 'AI_CASE_GENERATION_TIMEOUT' -Value '180s'
Set-DefaultEnvironmentValue -Name 'AI_CASE_GENERATION_MAX_RETRIES' -Value '1'
[Environment]::SetEnvironmentVariable('PORT', "$Port", 'Process')
[Environment]::SetEnvironmentVariable('AI_ENABLED', 'true', 'Process')
[Environment]::SetEnvironmentVariable('AI_OFFLINE_MODE', 'false', 'Process')
[Environment]::SetEnvironmentVariable('AI_PROVIDER', 'gemini', 'Process')

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' Arcadia AI 서버 — 실제 Gemini 모드' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "주소: http://127.0.0.1:$Port"
Write-Host "모델: $([Environment]::GetEnvironmentVariable('GEMINI_TEXT_MODEL', 'Process'))"
Write-Host 'API 키: .env에서 로드됨 (값은 출력하지 않음)'
Write-Host '종료: Ctrl+C'
Write-Host ''

if (-not (Test-Path -LiteralPath $mavenWrapper)) {
    throw "Maven Wrapper를 찾을 수 없습니다: $mavenWrapper"
}

& $mavenWrapper spring-boot:run
exit $LASTEXITCODE
