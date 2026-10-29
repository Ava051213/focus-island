# 一键启动：确保 vite 开发服务器在运行，然后启动调试版应用。
# 已启动时再次运行只会唤起面板（单实例插件负责）。

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\debug\focus-island.exe'
$port = 1420

function Show-Error([string]$message) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup($message, 8, '专注岛启动失败', 16)
    } catch {
        Write-Host $message
    }
}

function Test-DevServer {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

Set-Location $root

if (-not (Test-Path $exe)) {
    Show-Error "未找到可执行文件：`n$exe`n请先执行 npm run dev 或 cargo build。"
    exit 1
}

if (-not (Test-DevServer)) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) {
        Show-Error '未找到 npm.cmd，请确认 Node.js 已安装并加入 PATH。'
        exit 1
    }
    Start-Process -FilePath $npm -ArgumentList 'run', 'vite:dev' `
        -WorkingDirectory $root -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(40)
    while (-not (Test-DevServer) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-DevServer)) {
        Show-Error 'vite 开发服务器启动超时，请在该项目目录执行 npm run vite:dev 查看报错。'
        exit 1
    }
}

Start-Process -FilePath $exe -WorkingDirectory (Join-Path $root 'src-tauri')
