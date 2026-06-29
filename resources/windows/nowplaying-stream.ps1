# nowplaying-stream.ps1
# Emits one JSON line whenever the system "now playing" state changes.
# Mirrors the line protocol used by macOS `media-control stream` so the
# Electron app can parse both identically: {"type":"data","diff":false,"payload":{...}}
#
# Uses the WinRT GlobalSystemMediaTransportControlsSessionManager (SMTC), which
# exposes media from any integrated app/browser (Spotify, Chrome, Edge, etc).

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

# Helper to synchronously await a WinRT IAsyncOperation<T>.
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

# Force-load the WinRT projections.
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Read-Thumbnail($thumbRef) {
  if ($null -eq $thumbRef) { return $null }
  try {
    $stream = Await ($thumbRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [uint32]$stream.Size
    if ($size -le 0) { return $null }
    $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
    Await ($reader.LoadAsync($size)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    return [System.Convert]::ToBase64String($bytes)
  } catch {
    return $null
  }
}

function Get-State {
  $session = $manager.GetCurrentSession()
  if ($null -eq $session) { return $null }

  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $timeline = $session.GetTimelineProperties()
  $playback = $session.GetPlaybackInfo()

  $isPlaying = $false
  if ($null -ne $playback -and $null -ne $playback.PlaybackStatus) {
    $isPlaying = ($playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
  }

  $duration = 0.0
  $elapsed = 0.0
  if ($null -ne $timeline) {
    $duration = $timeline.EndTime.TotalSeconds - $timeline.StartTime.TotalSeconds
    $elapsed = $timeline.Position.TotalSeconds - $timeline.StartTime.TotalSeconds
  }

  return [ordered]@{
    title            = [string]$props.Title
    artist           = [string]$props.Artist
    album            = [string]$props.AlbumTitle
    artworkData      = (Read-Thumbnail $props.Thumbnail)
    artworkMimeType  = 'image/png'
    duration         = [math]::Round($duration, 3)
    elapsedTime      = [math]::Round($elapsed, 3)
    playing          = $isPlaying
    timestamp        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    bundleIdentifier = [string]$session.SourceAppUserModelId
  }
}

# Identity of the current state, excluding the constantly-changing timestamp,
# so we only emit a line when something the user cares about actually changes.
function Get-Identity($state) {
  if ($null -eq $state) { return '__none__' }
  return "$($state.title)|$($state.artist)|$($state.album)|$($state.playing)|$([math]::Round($state.elapsedTime))|$($state.duration)"
}

$lastIdentity = '__init__'
while ($true) {
  $state = Get-State
  $identity = Get-Identity $state
  if ($identity -ne $lastIdentity) {
    $lastIdentity = $identity
    if ($null -eq $state) {
      $line = @{ type = 'data'; diff = $false; payload = @{} }
    } else {
      $line = @{ type = 'data'; diff = $false; payload = $state }
    }
    $line | ConvertTo-Json -Compress -Depth 4
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 700
}
