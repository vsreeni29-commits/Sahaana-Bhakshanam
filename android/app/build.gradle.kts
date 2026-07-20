import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The web host is configurable (repo variable WEB_APP_URL / -PWEB_APP_URL);
// nothing here hardcodes a future custom domain.
val webAppUrl: String =
    (project.findProperty("WEB_APP_URL") as String?)
        ?: System.getenv("WEB_APP_URL")
        ?: "https://sahaana-bhakshanam.workers.dev"

val ciVersionCode: Int =
    (project.findProperty("VERSION_CODE") as String?)?.toIntOrNull()
        ?: System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull()
        ?: 1

// Optional permanent release keystore, supplied only through CI secrets.
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")
val hasReleaseKeystore = !keystorePath.isNullOrBlank() && file(keystorePath!!).exists()

android {
    // `in` is a Java keyword, so the code namespace differs from the
    // published application id (in.sahanabhakshanam.app), which is allowed.
    namespace = "app.sahanabhakshanam.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.sahanabhakshanam.app"
        // Adaptive icons (mipmap-anydpi-v26) set the floor at Android 8.0.
        minSdk = 26
        targetSdk = 35
        versionCode = ciVersionCode
        versionName = "1.0.$ciVersionCode"
        buildConfigField("String", "WEB_APP_URL", "\"$webAppUrl\"")
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                // Debug-signed release build: fine for sideload testing; Play
                // Store publishing requires the permanent release keystore.
                signingConfigs.getByName("debug")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
