# Build in a clean temporary tree. Synced Windows folders can inject desktop.ini
# into Android resource directories, where aapt treats it as an invalid resource.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$source = (Resolve-Path (Join-Path $repo "apps/android")).Path
$tempRoot = (Resolve-Path (Get-Item ([System.IO.Path]::GetTempPath())).FullName).Path
$stage = Join-Path $tempRoot ("farvater-android-" + [guid]::NewGuid().ToString("N"))
$null = New-Item -ItemType Directory -Path $stage
$savedJava = $env:JAVA_HOME
$savedSdk = $env:ANDROID_HOME
try {
    $files = git -C $source -c core.quotepath=false ls-files --cached --others --exclude-standard -- .
    if ($LASTEXITCODE -ne 0) { throw "Git could not list Android sources" }
    foreach ($file in ($files | Sort-Object -Unique)) {
        $from = Join-Path $source $file
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
        $to = Join-Path $stage $file
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to)
        Copy-Item -LiteralPath $from -Destination $to
    }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android/Sdk" }
    $studioJava = Join-Path $env:ProgramFiles "Android/Android Studio/jbr"
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $studioJava)) { $env:JAVA_HOME = $studioJava }
    Push-Location $stage
    try {
        & .\gradlew.bat --max-workers=2 --console=plain testDebugUnitTest assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Android build failed" }
    } finally {
        Pop-Location
    }
    $artifacts = Join-Path $repo ".local/apk"
    $null = New-Item -ItemType Directory -Force -Path $artifacts
    $apk = Join-Path $artifacts "farvater-driver-debug.apk"
    Copy-Item -LiteralPath (Join-Path $stage "app/build/outputs/apk/debug/app-debug.apk") -Destination $apk
    Write-Output "APK: $apk"
} finally {
    $env:JAVA_HOME = $savedJava
    $env:ANDROID_HOME = $savedSdk
    $target = (Resolve-Path -LiteralPath $stage).Path
    if (((Split-Path -Parent $target).TrimEnd('\') -eq $tempRoot.TrimEnd('\')) -and
        ((Split-Path -Leaf $target) -match '^farvater-android-[a-f0-9]{32}$')) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
