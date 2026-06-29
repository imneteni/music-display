# volume.ps1 get | set <0-100>
# Reads or sets the Windows master output volume via the CoreAudio API
# (IMMDeviceEnumerator -> IAudioEndpointVolume), exposed through a small
# inline C# shim so we don't depend on any external binaries.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$Value = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  int GetMute(out bool mute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public class AudioManager {
  static IAudioEndpointVolume GetVolumeObject() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 1, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume() {
    float level;
    GetVolumeObject().GetMasterVolumeLevelScalar(out level);
    return level;
  }
  public static void SetVolume(float level) {
    GetVolumeObject().SetMasterVolumeLevelScalar(level, Guid.Empty);
  }
}
'@

switch ($Action.ToLower()) {
  'get' {
    $level = [AudioManager]::GetVolume()
    [int][math]::Round($level * 100)
  }
  'set' {
    $clamped = [math]::Max(0, [math]::Min(100, $Value))
    [AudioManager]::SetVolume([float]($clamped / 100.0))
  }
}
