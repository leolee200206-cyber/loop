$ErrorActionPreference = 'Stop'
$cloudConfigPath = Join-Path $PSScriptRoot 'data\cloud-connection.json'
if (Test-Path -LiteralPath $cloudConfigPath) {
    $cloud = Get-Content -LiteralPath $cloudConfigPath -Raw | ConvertFrom-Json
    if ($cloud.mode -eq 'ssh-cloud') {
        Stop-ScheduledTask -TaskName $cloud.task_name -ErrorAction SilentlyContinue
        $sshPath = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
        $destination = [string]$cloud.user + '@' + [string]$cloud.host
        Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object {
            $_.ExecutablePath -eq $sshPath -and
            $_.CommandLine.Contains('127.0.0.1:39765:127.0.0.1:39765') -and
            $_.CommandLine.Contains($destination) -and
            $_.CommandLine.Contains([string]$cloud.key_path)
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        Write-Host 'Local cloud connection stopped. The cloud AgentChatBus service remains running.'
        exit 0
    }
}
$statePath = Join-Path $PSScriptRoot 'data\server-process.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No recorded server process.'; exit 0 }
$saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$existing = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
if (-not $existing) { Write-Host 'Server is already stopped.'; exit 0 }
if ($existing.Path -ne (Join-Path $PSScriptRoot 'runtime\node.exe') -or $existing.StartTime.ToUniversalTime().Ticks -ne ([datetime]$saved.started).ToUniversalTime().Ticks) {
    throw 'Recorded process identity does not match. No process was stopped.'
}
Stop-Process -Id $existing.Id
Write-Host 'AgentChatBus stopped.'
