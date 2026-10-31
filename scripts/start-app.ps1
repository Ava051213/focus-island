# 一键启动已构建的 release 版；重复启动会由单实例机制唤起已有面板。
# 前端改动需要重新构建才生效；开发热更新请用 npm run dev。

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\focus-island.exe'
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

try {
    Set-Location $root
    Write-Log '启动脚本开始运行'

    if (-not (Test-Path $exe)) {
        Show-Error "未找到可执行文件：`n$exe`n请先运行 npx tauri build --no-bundle。"
        exit 1
    }

    $running = @(Get-Process -Name 'focus-island' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        Write-Log "已有实例在运行：$($running[0].Id)"
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
