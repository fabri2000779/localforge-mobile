plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "gg.localforge.restorecred"
    // androidx.credentials 1.6 needs compileSdk 35.
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
    // Credential Manager + the Play services provider that implements Restore Credentials
    // (Block Store). Needs Android 9+ with Play services at runtime; the plugin reports
    // `unsupported` below that. Built with Kotlin 2.1: the generated app project is moved to
    // Kotlin 2 by scripts/patch-android-kotlin.cjs in CI.
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    // Tauri drops its generated Android library here during the build;
    // `settings.gradle` points the :tauri-android subproject at it.
    implementation(project(":tauri-android"))
}
