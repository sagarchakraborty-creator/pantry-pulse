# Pantry Pulse: serves this folder at http://localhost:8771/ for testing on the PC.
# Run:  powershell -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 8771)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Pantry Pulse running at http://localhost:$Port/  (Ctrl+C to stop)"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json';
            '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  $res = $ctx.Response
  try {
    if ($path -eq '') { $path = 'index.html' }
    $file = Join-Path $root $path
    if ((Test-Path $file -PathType Leaf) -and ([IO.Path]::GetFullPath($file).StartsWith($root))) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
  } catch { $res.StatusCode = 500; Write-Host "Error: $($_.Exception.Message)" }
  $res.Close()
}
