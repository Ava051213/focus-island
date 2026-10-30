# 一键启动：确保 vite 开发服务器在运行，然后启动调试版应用。
# 已启动时再次运行只会唤起面板（单实例插件负责）。

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\debug\focus-island.exe'
$port = 1420
$log = Join-Path $env:TEMP 'focus-island-launch.log'

function Write-Log([string]$message) {
    $line = '{0} {1}' -f (Get-Date -Format 'HH:mm:ss'), $message
    Add-Content -Path $log -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Show-Error([string]$message) {
    Write-Log "ERROR: $message"
    try {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup("$message`n`n日志：$log", 10, '专注岛启动失败', 16)
    } catch {
        Write-Host $message
    }
}

function Test-DevServer {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

try {
    Set-Location $root
    Write-Log '启动脚本开始运行'

    if (-not (Test-Path $exe)) {
        Show-Error "未找到可执行文件：`n$exe`n请先执行 npm run dev 或 cargo build。"
        exit 1
    }

    $running = @(Get-Process -Name 'focus-island' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        Write-Log "已有实例在运行：$($running[0].Id)"
    }

    if (-not (Test-DevServer)) {
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
        if (-not $npm) {
            Show-Error '未找到 npm.cmd，请确认 Node.js 已安装并加入 PATH。'
            exit 1
        }
        Start-Process -FilePath $npm -ArgumentList 'run', 'vite:dev' `
            -WorkingDirectory $root -WindowStyle Hidden
        Write-Log '已启动 vite 开发服务器，等待端口就绪'

        $deadline = (Get-Date).AddSeconds(40)
        while (-not (Test-DevServer) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
        }
        if (-not (Test-DevServer)) {
            Show-Error 'vite 开发服务器启动超时，请在该项目目录执行 npm run vite:dev 查看报错。'
            exit 1
        }
        Write-Log 'vite 端口 1420 已就绪'
    }

    $proc = Start-Process -FilePath $exe `
        -WorkingDirectory (Join-Path $root 'src-tauri') -PassThru
    Start-Sleep -Milliseconds 2500
    if ($proc.HasExited) {
        Write-Log "应用进程已退出，退出码=$($proc.ExitCode)"
        if ($proc.ExitCode -ne 0) {
            Show-Error "应用启动后立即退出（退出码 $($proc.ExitCode)）。"
            exit 1
        }
        Write-Log '检测到已有实例接管本次启动（单实例机制），请查看托盘或灵动岛'
    } else {
        Write-Log "应用已启动，PID=$($proc.Id)"
    }
} catch {
    Show-Error "启动过程出错：$($_.Exception.Message)"
    exit 1
}
