# control.ps1 <command> [position]
# Performs a playback control action on the current SMTC session.
# Commands: play | pause | toggle | next | previous | seek
param(
  [Parameter(Mandatory = $true)][string]$Command,
  [double]$Position = 0
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, $resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $manager.GetCurrentSession()
if ($null -eq $session) { exit 0 }

switch ($Command.ToLower()) {
  'play' { Await ($session.TryPlayAsync()) ([bool]) | Out-Null }
  'pause' { Await ($session.TryPauseAsync()) ([bool]) | Out-Null }
  'toggle' { Await ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
  'next' { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null }
  'previous' { Await ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null }
  'seek' {
    # TryChangePlaybackPositionAsync takes ticks (100ns units).
    $ticks = [long]($Position * 10000000)
    Await ($session.TryChangePlaybackPositionAsync($ticks)) ([bool]) | Out-Null
  }
}
