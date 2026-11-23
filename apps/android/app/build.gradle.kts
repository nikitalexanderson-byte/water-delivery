import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val driverApiUrl = providers.environmentVariable("ANDROID_API_URL")
    .orElse("http://10.0.2.2:8080").get().trimEnd('/')
val uri = URI(driverApiUrl)
require(uri.scheme in listOf("http", "https") && uri.host != null && uri.userInfo == null &&
    uri.query == null && uri.fragment == null && uri.path.isNullOrEmpty()) {
    "ANDROID_API_URL must contain an HTTP(S) origin, e.g. http://10.0.2.2:8080"
}
android {
    namespace = "ru.farvater.driver"
    compileSdk { version = release(36) { minorApiLevel = 1 } }
    defaultConfig {
        applicationId = "ru.farvater.driver"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "API_URL", "\"${driverApiUrl}\"")
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
dependencies {
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    testImplementation("junit:junit:4.13.2")
}
