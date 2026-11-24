import com.android.build.api.variant.BuildConfigField
import com.android.build.api.variant.HostTestBuilder
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val driverApiUrl = providers.environmentVariable("ANDROID_API_URL")
    .orElse("http://10.0.2.2:8080").get().trimEnd('/')
val uri = URI(driverApiUrl)
val androidVersionCode = providers.environmentVariable("ANDROID_VERSION_CODE").map {
    it.toInt().also { value -> require(value in 1..2_100_000_000) { "ANDROID_VERSION_CODE must be in 1..2100000000" } }
}.orElse(1)
require(uri.scheme in listOf("http", "https") && uri.host != null && uri.userInfo == null &&
    uri.query == null && uri.fragment == null && uri.path.isNullOrEmpty()) {
    "ANDROID_API_URL must contain an HTTP(S) origin, e.g. http://10.0.2.2:8080"
}
android {
    namespace = "ru.farvater.driver"
    compileSdk { version = release(36) { minorApiLevel = 1 } }
    val mapAssets = providers.gradleProperty("routeMapAssetsDir")
        .orElse(rootProject.file("../../packages/route-map/static").absolutePath)
    sourceSets.getByName("main").assets.directories.add(mapAssets.get())
    defaultConfig {
        applicationId = "ru.farvater.driver"
        minSdk = 26
        targetSdk = 36
        versionCode = androidVersionCode.get()
        versionName = "0.1.0"
        buildConfigField("String", "API_URL", "\"${driverApiUrl}\"")
    }
    buildTypes {
        debug {
            if (providers.gradleProperty("qaApp").isPresent) applicationIdSuffix = ".qa"
        }
        create("play") {
            initWith(getByName("release"))
            matchingFallbacks += "release"
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
androidComponents {
    beforeVariants(selector().withBuildType("play")) { variant ->
        variant.hostTests.getValue(HostTestBuilder.UNIT_TEST_TYPE).enable = true
    }
    onVariants(selector().all()) { variant ->
        if (variant.buildType == "debug" || variant.buildType == "release") {
            variant.sources.kotlin?.addStaticSourceDirectory("src/direct/kotlin")
            variant.sources.res?.addStaticSourceDirectory("src/direct/res")
            variant.sources.manifests.addStaticManifestFile("src/direct/AndroidManifest.xml")
        }
        if (variant.buildType != "debug") {
            variant.buildConfigFields!!.put("API_URL", providers.provider {
                require(uri.scheme == "https") { "Set ANDROID_API_URL to an HTTPS origin for distributed builds" }
                BuildConfigField("String", "\"$driverApiUrl\"", null)
            })
        }
    }
}
dependencies {
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
