$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'data\cloud-connection.json') -Raw | ConvertFrom-Json
$ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$log = Join-Path $root 'logs\cloud-tunnel-error.log'
$monitorLog = Join-Path $root 'logs\cloud-tunnel-supervisor.log'
$mutex = New-Object System.Threading.Mutex($false, 'Local\AgentChatBusCloudTunnel')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
    while ($true) {
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576) {
            Set-Content -LiteralPath $log -Value 'Log rotated.' -Encoding UTF8
        }
        if (Get-NetTCPConnection -LocalPort 39765 -State Listen -ErrorAction SilentlyContinue) {
            Add-Content -LiteralPath $log -Value ('[' + [DateTime]::Now.ToString('o') + '] Local port is occupied; waiting.')
            Start-Sleep -Seconds 5
            continue
        }
        $arguments = @('-N','-T','-i',[string]$config.key_path,
            '-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
            '-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
            '-o','ExitOnForwardFailure=yes','-L','127.0.0.1:39765:127.0.0.1:39765',
            ([string]$config.user + '@' + [string]$config.host))
        Add-Content -LiteralPath $log -Value ('[' + [DateTime]::Now.ToString('o') + '] Connecting cloud tunnel.')
        $exitCode = -1
        try {
            # Launch directly without a visible terminal. These are fixed SSH
            # arguments/config values, never chat message text or shell code.
            if ($arguments | Where-Object { $_ -match '["\r\n]' }) { throw 'Invalid SSH argument in cloud configuration.' }
            $quotedArguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
            $tunnelProcess = Start-Process -FilePath $ssh -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru -RedirectStandardError $log
            $failedProbes = 0
            try {
                while (-not $tunnelProcess.HasExited) {
                    Start-Sleep -Seconds 10
                    $tunnelProcess.Refresh()
                    if ($tunnelProcess.HasExited) { break }
                    try {
                        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:39765/health' -UseBasicParsing -TimeoutSec 4
                        if ($health.StatusCode -ne 200) { throw 'Health endpoint unavailable.' }
                        $failedProbes = 0
                    } catch {
                        $failedProbes++
                        Add-Content -LiteralPath $monitorLog -Value ('[' + [DateTime]::Now.ToString('o') + '] Tunnel health failure ' + $failedProbes)
                        if ($failedProbes -ge 3) {
                            Add-Content -LiteralPath $monitorLog -Value ('[' + [DateTime]::Now.ToString('o') + '] Reconnecting owned SSH tunnel; cloud service unchanged.')
                            if (-not $tunnelProcess.HasExited) { Stop-Process -InputObject $tunnelProcess -Force }
                            break
                        }
                    }
                }
                $tunnelProcess.WaitForExit()
                $exitCode = $tunnelProcess.ExitCode
            } finally {
                if (-not $tunnelProcess.HasExited) { Stop-Process -InputObject $tunnelProcess -Force }
                $tunnelProcess.Dispose()
            }
        } catch {
            Add-Content -LiteralPath $monitorLog -Value ('[' + [DateTime]::Now.ToString('o') + '] Tunnel launch or supervision failed.')
        }
        Add-Content -LiteralPath $log -Value ('[' + [DateTime]::Now.ToString('o') + '] Tunnel exited: ' + $exitCode)
        Start-Sleep -Seconds 3
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
