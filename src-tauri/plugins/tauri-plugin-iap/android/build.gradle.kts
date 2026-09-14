plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "gg.localforge.iap"
    // Play Billing 9.x pulls androidx.core 1.15, which needs compileSdk 35.
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

// Kotlin 2 DSL (kotlinOptions is deprecated); must match compileOptions above.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    // Google Play Billing — the subscription purchase + restore flow.
    // Play rejects updates on anything below 8.x from 2026-08-31.
    implementation("com.android.billingclient:billing:9.1.0")
    // Tauri drops its generated Android library here during the build;
    // `settings.gradle` points the :tauri-android subproject at it.
    implementation(project(":tauri-android"))
}
