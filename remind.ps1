$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = Join-Path $root "index.html"

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = "Spending tracker"
$notify.BalloonTipText = "It is 10:30 PM. Add today's spending."
$notify.ShowBalloonTip(15000)

try {
  $xml = @"
<toast activationType="protocol" launch="file:///$($html.Replace('\','/'))">
  <visual>
    <binding template="ToastGeneric">
      <text>Spending tracker</text>
      <text>It is 10:30 PM. Add today's spending.</text>
    </binding>
  </visual>
</toast>
"@
  $XmlDocument = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::new()
  $XmlDocument.LoadXml($xml)
  $toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::new($XmlDocument)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier("SpendingTracker")
  $notifier.Show($toast)
} catch {}

if (Test-Path $html) {
  Start-Process $html
}

Start-Sleep -Seconds 16
$notify.Dispose()
