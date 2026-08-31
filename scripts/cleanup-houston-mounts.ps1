<#
.SYNOPSIS
  Removes Storage Wizard SMB leftovers on Windows: credential files, saved
  Windows credentials (cmdkey) and dead mapped drives that are not referenced
  by an installed "Houston_Backup_Task_*" scheduled task.

.EXAMPLE
  .\cleanup-houston-mounts.ps1            # dry run
  .\cleanup-houston-mounts.ps1 -Apply     # actually remove
#>
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$credDir = Join-Path $env:LOCALAPPDATA 'houston-backups\credentials'

# Hosts still referenced by an installed Houston scheduled task.
$inUseHosts = @()
Get-ScheduledTask -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -like '*Houston_Backup_Task*' } |
  ForEach-Object {
    foreach ($a in $_.Actions) {
      if ($a.Execute -and (Test-Path $a.Execute)) {
        $m = Select-String -Path $a.Execute -Pattern 'set "SMB_HOST=([^"]+)"' -ErrorAction SilentlyContinue
        if ($m) { $inUseHosts += $m.Matches[0].Groups[1].Value }
      }
    }
  }
$inUseHosts = $inUseHosts | Sort-Object -Unique

Write-Host "Credential files in $credDir :"
$stale = @()
if (Test-Path $credDir) {
  Get-ChildItem $credDir -Filter *.cred | ForEach-Object {
    $key     = $_.BaseName                   # host_share_user
    $srvHost = $key.Split('_')[0]
    if ($inUseHosts -contains $srvHost) {
      Write-Host ("  KEEP   {0}  (used by a scheduled task)" -f $key)
    } else {
      Write-Host ("  REMOVE {0}  (stale)" -f $key)
      $stale += $_
    }
  }
}

Write-Host "`nMapped drives pointing at Houston hosts:"
$deadDrives = @()
Get-SmbMapping -ErrorAction SilentlyContinue | ForEach-Object {
  $srvHost = ($_.RemotePath -replace '^\\\\([^\\]+)\\.*$', '$1')
  if ($_.Status -ne 'OK' -and ($inUseHosts -notcontains $srvHost)) {
    Write-Host ("  REMOVE {0} -> {1}  ({2})" -f $_.LocalPath, $_.RemotePath, $_.Status)
    $deadDrives += $_
  } else {
    Write-Host ("  KEEP   {0} -> {1}" -f $_.LocalPath, $_.RemotePath)
  }
}

Write-Host "`nStored Windows credentials (cmdkey):"
$staleCmdKeys = @()
(cmdkey /list) -split "`r?`n" |
  Where-Object { $_ -match 'Target:\s*(.+)' } |
  ForEach-Object {
    $t = $Matches[1].Trim()
    if ($t -match 'Domain:target=(.+)$') {
      $srvHost = $Matches[1]
      if ($inUseHosts -notcontains $srvHost) { Write-Host "  REMOVE $t"; $staleCmdKeys += $t }
      else { Write-Host "  KEEP   $t" }
    }
  }

if (-not $Apply) {
  Write-Host "`nDry run - re-run with -Apply to remove."
  return
}

$stale       | ForEach-Object { Remove-Item $_.FullName -Force }
$deadDrives  | ForEach-Object { Remove-SmbMapping -LocalPath $_.LocalPath -Force -ErrorAction SilentlyContinue }
$staleCmdKeys| ForEach-Object { cmdkey /delete:$_ | Out-Null }

Write-Host "`nRemoved $($stale.Count) credential file(s), $($deadDrives.Count) mapping(s), $($staleCmdKeys.Count) stored credential(s)."
