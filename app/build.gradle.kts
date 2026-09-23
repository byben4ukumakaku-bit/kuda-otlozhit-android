plugins {
    id("com.android.application")
}

android {
    namespace = "ru.kudaotlozhit.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ru.kudaotlozhit.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.0")
}
