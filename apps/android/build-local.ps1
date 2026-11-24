# Build in a clean temporary tree. Synced Windows folders can inject desktop.ini
# into Android resource directories, where aapt treats it as an invalid resource.
param([switch]$Usb, [switch]$Qa, [switch]$Play, [switch]$Release)
$ErrorActionPreference = "Stop"
if ($Play -and ($Usb -or $Qa)) { throw "-Play creates a store bundle. Use -Usb and -Qa for debug APKs." }
if ($Release -and ($Usb -or $Qa -or $Play)) { throw "-Release creates a standalone unsigned APK. Use -Release on its own." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$source = (Resolve-Path (Join-Path $repo "apps/android")).Path
$tempRoot = (Resolve-Path (Get-Item ([System.IO.Path]::GetTempPath())).FullName).Path
$stage = Join-Path $tempRoot ("farvater-android-" + [guid]::NewGuid().ToString("N"))
$null = New-Item -ItemType Directory -Path $stage
$savedJava = $env:JAVA_HOME
$savedSdk = $env:ANDROID_HOME
$savedApi = $env:ANDROID_API_URL
try {
    if ($Usb) { $env:ANDROID_API_URL = 'http://127.0.0.1:18019' }
    $files = git -C $source -c core.quotepath=false ls-files --cached --others --exclude-standard -- .
    if ($LASTEXITCODE -ne 0) { throw "Git could not list Android sources" }
    foreach ($file in ($files | Sort-Object -Unique)) {
        $from = Join-Path $source $file
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
        $to = Join-Path $stage $file
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to)
        Copy-Item -LiteralPath $from -Destination $to
    }
    $mapSource = Join-Path $repo "packages/route-map/static"
    $mapStage = Join-Path $stage "route-map-assets"
    if (-not (Test-Path -LiteralPath (Join-Path $mapSource "route-map/index.html"))) {
        throw "Missing shared route map in packages/route-map/static"
    }
    $mapFiles = git -C $mapSource -c core.quotepath=false ls-files --cached --others --exclude-standard -- .
    if ($LASTEXITCODE -ne 0) { throw "Git could not list shared map assets" }
    foreach ($file in ($mapFiles | Sort-Object -Unique)) {
        $from = Join-Path $mapSource $file
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
        $to = Join-Path $mapStage $file
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to)
        Copy-Item -LiteralPath $from -Destination $to
    }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android/Sdk" }
    $studioJava = Join-Path $env:ProgramFiles "Android/Android Studio/jbr"
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $studioJava)) { $env:JAVA_HOME = $studioJava }
    Push-Location $stage
    try {
        $gradleArguments = @("-ProuteMapAssetsDir=$mapStage", "--max-workers=2", "--console=plain")
        if ($Play) {
            $gradleArguments += @(":app:testPlayUnitTest", ":app:bundlePlay")
        } elseif ($Release) {
            $gradleArguments += @(":app:testDebugUnitTest", ":app:assembleRelease")
        } else {
            $gradleArguments += @("testDebugUnitTest", "assembleDebug")
        }
        if ($Qa) { $gradleArguments += "-PqaApp" }
        & .\gradlew.bat @gradleArguments
        if ($LASTEXITCODE -ne 0) { throw "Android build failed" }
    } finally {
        Pop-Location
    }
    if ($Play) {
        $artifacts = Join-Path $repo ".local/aab"
        $null = New-Item -ItemType Directory -Force -Path $artifacts
        $bundle = Join-Path $artifacts "farvater-play.aab"
        Copy-Item -LiteralPath (Join-Path $stage "app/build/outputs/bundle/play/app-play.aab") -Destination $bundle
        Write-Output "AAB: $bundle"
        return
    }
    $artifacts = Join-Path $repo ".local/apk"
    $null = New-Item -ItemType Directory -Force -Path $artifacts
    if ($Release) {
        $apk = Join-Path $artifacts "wayslate-release-unsigned.apk"
        Copy-Item -LiteralPath (Join-Path $stage "app/build/outputs/apk/release/app-release-unsigned.apk") -Destination $apk
        Write-Output "APK: $apk"
        return
    }
    $usbSuffix = if ($Usb) { "-usb" } else { "" }
    $qaSuffix = if ($Qa) { "-qa" } else { "" }
    $apk = Join-Path $artifacts "farvater-driver$usbSuffix$qaSuffix-debug.apk"
    Copy-Item -LiteralPath (Join-Path $stage "app/build/outputs/apk/debug/app-debug.apk") -Destination $apk
    Write-Output "APK: $apk"
} finally {
    $env:JAVA_HOME = $savedJava
    $env:ANDROID_HOME = $savedSdk
    $env:ANDROID_API_URL = $savedApi
    $target = (Resolve-Path -LiteralPath $stage).Path
    if (((Split-Path -Parent $target).TrimEnd('\') -eq $tempRoot.TrimEnd('\')) -and
        ((Split-Path -Leaf $target) -match '^farvater-android-[a-f0-9]{32}$')) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
