# 選秀演練用的測試站（8084，資料庫 cpblf_drafttest，真實站的複本）。步驟與注意事項見 docs/draft-test.md。
#
#   .\scripts\draft-test.ps1 status      看測試站、對外網址與選秀狀態
#   .\scripts\draft-test.ps1 snapshot    把目前的 cpblf_drafttest 存成快照 cpblf_dt_snap（選秀開始「前」做）
#   .\scripts\draft-test.ps1 reset       停掉測試站 → 用快照重建 cpblf_drafttest → 重新啟動（選秀不能重來，演練完用這個）
#   .\scripts\draft-test.ps1 start       啟動測試站（-BuildWeb 先重新建置前端）
#   .\scripts\draft-test.ps1 stop        停掉測試站
#   .\scripts\draft-test.ps1 funnel      對外開放 https://<本機>.ts.net:8443（只轉到 8084）；funnel-off 關閉
#
# 只會動 cpblf_drafttest／cpblf_dt_snap 與 8084／8443，不會碰真實站（8080、cpblf_stats）。
param(
  [ValidateSet('status', 'snapshot', 'reset', 'start', 'stop', 'funnel', 'funnel-off')]
  [string]$Action = 'status',
  [switch]$BuildWeb
)
$ErrorActionPreference = 'Stop'
$Db = 'cpblf_drafttest'
$Snap = 'cpblf_dt_snap'
$Port = 8084
$Repo = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $Repo 'server'
$Container = 'cpbl-fantasy-db-1'
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$Log = Join-Path $env:TEMP 'drafttest8084.out.log'

function Psql([string]$db, [string]$sql) { docker exec $Container psql -U cpblf -d $db -At -c $sql }
function Listener([int]$port) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
}
function Stop-Test {
  $p = Listener $Port
  if ($p) { Stop-Process -Id $p -Force; Start-Sleep -Seconds 3; Write-Output "已停止 $Port（pid $p）" } else { Write-Output "$Port 沒有在跑" }
}
function Copy-Db([string]$from, [string]$to) {
  if ($to -notin @($Db, $Snap)) { throw "拒絕覆寫 $to" }
  docker exec $Container psql -U cpblf -d postgres -c "drop database if exists $to with (force)" -c "create database $to owner cpblf" | Out-Null
  # 在容器裡 pipe，避免 PowerShell 轉碼弄壞中文
  docker exec $Container sh -c "pg_dump -U cpblf $from | psql -q -U cpblf -d $to" | Out-Null
  Write-Output "已複製 $from → $to"
}
function Start-Test {
  if (Listener $Port) { Write-Output "$Port 已經在跑"; return }
  if ($BuildWeb) {
    Push-Location (Join-Path $Repo 'web'); npm run build; Pop-Location
  }
  # 年份設 2027：進階數據網站只保留當季，上一季（2026）的參考季資料才抓得到（見 docs/draft-test.md）
  $env:PORT = "$Port"; $env:CPBLF_SOURCE = 'stats'; $env:CPBLF_DB_URL = "jdbc:postgresql://localhost:5432/$Db"
  $env:CPBLF_POSTSEASON_KINDS = 'A'; $env:CPBLF_SEASON_YEAR = '2027'
  # 每日名單同步會把複本裡改成一軍的球員改回二軍，演練的球員池就缺人，所以關掉
  $env:CPBLF_REGISTRATION_SYNC_ENABLED = 'false'
  Remove-Item Env:CPBLF_SCHEDULER_ENABLED -ErrorAction SilentlyContinue   # 排程要開：選秀自動開始、逾時、託管都靠它
  Start-Process -FilePath (Join-Path $Server 'mvnw.cmd') -ArgumentList 'spring-boot:run' -WorkingDirectory $Server -WindowStyle Hidden `
    -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
  for ($i = 0; $i -lt 70; $i++) {
    Start-Sleep -Seconds 3
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/api/system" -TimeoutSec 3; if ($r.StatusCode -eq 200) { Write-Output "已啟動：$($r.Content)"; return } } catch { }
  }
  throw "啟動逾時，看 $Log.err"
}

switch ($Action) {
  'status' {
    $p = Listener $Port
    Write-Output ("測試站 {0}：{1}" -f $Port, $(if ($p) { "執行中（pid $p）" } else { '沒有在跑' }))
    Write-Output (& $Tailscale funnel status 2>&1 | Out-String)
    Write-Output "選秀：$(Psql $Db "select string_agg(season_half_id || ':' || status, ' ') from draft")"
    Write-Output "快照 $Snap：$(Psql 'postgres' "select count(*) from pg_database where datname = '$Snap'") 個"
  }
  'snapshot' { Copy-Db $Db $Snap }
  'reset' {
    if (-not (Psql 'postgres' "select 1 from pg_database where datname = '$Snap'")) { throw "沒有快照 $Snap，請先在選秀開始前執行 snapshot" }
    Stop-Test
    Copy-Db $Snap $Db
    Start-Test
  }
  'start' { Start-Test }
  'stop' { Stop-Test }
  'funnel' { & $Tailscale funnel --https=8443 --bg $Port }
  'funnel-off' { & $Tailscale funnel --https=8443 off }
}
