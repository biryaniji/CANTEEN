$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\Program Files\nodejs;$env:APPDATA\npm"
Write-Host "Starting Masters Union Canteen server..." -ForegroundColor Cyan
npm start
