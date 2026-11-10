$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$cloudConfigPath = Join-Path $appRoot 'data\cloud-connection.json'
if (Test-Path -LiteralPath $cloudConfigPath) {
    $cloud = Get-Content -LiteralPath $cloudConfigPath -Raw | ConvertFrom-Json
    if ($cloud.mode -eq 'ssh-cloud') {
        $task = Get-ScheduledTask -TaskName $cloud.task_name -ErrorAction Stop
        if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $cloud.task_name }
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:39765/health' -TimeoutSec 2
                if ($health.status -eq 'ok') {
                    $diagnostics = Invoke-RestMethod -Uri 'http://127.0.0.1:39765/api/integrations' -TimeoutSec 3
                    if ($diagnostics.local_data_dir -ne $cloud.remote_data_dir) {
                        throw 'The local port is serving another backend, not the configured cloud service.'
                    }
                    Write-Host 'Cloud AgentChatBus connected: http://127.0.0.1:39765/static/index.html'
                    Write-Host ('Cloud host: ' + $cloud.host + ' (systemd managed)')
                    exit 0
                }
            } catch { }
            Start-Sleep -Milliseconds 700
        }
        throw 'Cloud connection unavailable. Check logs\cloud-tunnel-error.log. No second local bus was started.'
    }
}
$statePath = Join-Path $appRoot 'data\server-process.json'
$nodePath = Join-Path $appRoot 'runtime\node.exe'
$entryPath = Join-Path $appRoot 'agentchatbus-server\dist\cli\index.js'
New-Item -ItemType Directory -Path (Join-Path $appRoot 'data'),(Join-Path $appRoot 'logs') -Force | Out-Null
if (Test-Path -LiteralPath $statePath) {
    $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.Path -eq $nodePath -and $existing.StartTime.ToUniversalTime().Ticks -eq ([datetime]$saved.started).ToUniversalTime().Ticks) {
        Write-Host 'AgentChatBus is already running: http://127.0.0.1:39765/static/index.html'
        exit 0
    }
}
if (Get-NetTCPConnection -LocalPort 39765 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 39765 is in use. No existing process was stopped.'
}
$env:AGENTCHATBUS_APP_DIR = Join-Path $appRoot 'data'
$env:AGENTCHATBUS_DB = Join-Path $appRoot 'data\bus.db'
$env:AGENTCHATBUS_CONFIG_FILE = Join-Path $appRoot 'data\config.json'
$env:AGENTCHATBUS_WEB_UI_DIR = Join-Path $appRoot 'agentchatbus-server\web-ui'
$env:AGENTCHATBUS_HOST = '127.0.0.1'
$env:AGENTCHATBUS_PORT = '39765'
$child = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $entryPath + '"'),'serve') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appRoot 'logs\server.log') -RedirectStandardError (Join-Path $appRoot 'logs\server-error.log') -PassThru
@{ pid=$child.Id; started=$child.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if ($child.HasExited) { throw 'Server exited. Check logs\server-error.log.' }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:39765/health' -TimeoutSec 2
        if ($health.status -eq 'ok') {
            Write-Host 'AgentChatBus started: http://127.0.0.1:39765/static/index.html'
            Write-Host 'MCP endpoint: http://127.0.0.1:39765/mcp'
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Health check timed out. Check logs\server-error.log.'
